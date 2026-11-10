import type { Node } from 'web-tree-sitter';
import type { AccessReader, Action, Cover, UnreadAccess } from '../../core/access.ts';
import { matchesWildcard } from '../../core/wildcard.ts';
import { classesOf, lookedUp, scopesOf, type Wanted, written } from './rails-graph.ts';
import { NOT_SEARCHED } from './reader.ts';
import { symbolsOfRuby } from './ruby-symbols.ts';
import {
  argsOf,
  constantWithin,
  isNameList,
  methodOf,
  nameOf,
  namesIn,
  optionOf,
  positional,
  readRuby,
  writtenIn,
} from './ruby-syntax.ts';

const CONTROLLER_FILE = /(^|\/)app\/controllers\/.+\.rb$/;

const DEFINITIONS: ReadonlySet<string> = new Set(['class', 'module']);

const CALLBACK = /^((prepend|append|skip)_)?(before|around|after)_action$/;

type Callback = {
  readonly skip: boolean;
  readonly after: boolean;
  readonly name: string;
  readonly only: ReadonlyArray<string> | undefined;
  readonly except: ReadonlyArray<string>;
  readonly conditional: boolean;
};

const namesCalledIn = (node: Node | null): ReadonlyArray<string> =>
  (node?.descendantsOfType('identifier') ?? []).map(({ text }) => text);

type Unread = { readonly unread: UnreadAccess };

type Step = Callback | Unread;

type Entry = Step | { readonly include: Wanted; readonly at: UnreadAccess };

type Reading = { readonly file: string; readonly authorize: ReadonlyArray<string> };

const AFTER_THE_ACTION = 'verify_authorized';

const authorizes = (authorize: ReadonlyArray<string>, name: string): boolean =>
  authorize.some(pattern => matchesWildcard(pattern, name));

const NAMES: ReadonlySet<string> = new Set([
  'simple_symbol',
  'bare_symbol',
  'bare_string',
  'string',
]);

const readsAsName = ({ type, namedChildren }: Node): boolean =>
  NAMES.has(type) && namedChildren.every(child => child.type === 'string_content');

const readsAsNames = (node: Node | undefined): boolean =>
  node === undefined || (isNameList(node) ? writtenIn(node).every(readsAsName) : readsAsName(node));

const unreadable = (call: Node, authorize: ReadonlyArray<string>): boolean => {
  const args = argsOf(call);
  if (args.some(({ type }) => type === 'splat_argument')) return true;
  if (!readsAsNames(optionOf(args, 'only')) || !readsAsNames(optionOf(args, 'except'))) return true;
  return bodiesOf(call).some(
    body => !namesCalledIn(body).some(name => authorizes(authorize, name)),
  );
};

const bodiesOf = (call: Node): ReadonlyArray<Node> => [
  ...positional(argsOf(call)).filter(arg => !readsAsName(arg)),
  ...[call.childForFieldName('block') ?? []].flat(),
];

type Reach = Omit<Callback, 'name'>;

const calledName = (node: Node): string =>
  node.type === 'identifier' ? node.text : methodOf(node);

const reachOf = (call: Node): Reach => {
  const args = argsOf(call);
  const only = optionOf(args, 'only');
  return {
    skip: calledName(call).startsWith('skip_'),
    after: calledName(call).endsWith('after_action'),
    only: only === undefined ? undefined : namesIn(only),
    except: namesIn(optionOf(args, 'except')),
    conditional: optionOf(args, 'if') !== undefined || optionOf(args, 'unless') !== undefined,
  };
};

const callbacksOfCall = (call: Node): ReadonlyArray<Callback> =>
  positional(argsOf(call))
    .filter(readsAsName)
    .map(nameOf)
    .concat(bodiesOf(call).flatMap(namesCalledIn))
    .map(name => ({ ...reachOf(call), name }));

const macroOf = (call: Node): Callback => ({
  ...reachOf(call),
  name: calledName(call).replace(/^skip_/, ''),
});

const rowOf = (node: Node, file: string): UnreadAccess => ({
  text: /^.*/.exec(node.text)?.[0] ?? '',
  file,
  line: node.startPosition.row + 1,
});

const unreadOf = (call: Node, { file, authorize }: Reading): ReadonlyArray<Unread> =>
  unreadable(call, authorize) ? [{ unread: rowOf(call, file) }] : [];

const entriesOf = (body: Node | null | undefined, reading: Reading): ReadonlyArray<Entry> =>
  (body?.namedChildren ?? []).flatMap(node => {
    const method = calledName(node);
    if (CALLBACK.test(method)) return [...callbacksOfCall(node), ...unreadOf(node, reading)];
    if (authorizes(reading.authorize, method.replace(/^skip_/, '')))
      return [macroOf(node), ...unreadOf(node, reading)];
    if (method === 'include')
      return argsOf(node).map(arg => ({
        include: written(arg),
        at: rowOf(node, reading.file),
      }));
    if (method === 'included')
      return entriesOf(node.childForFieldName('block')?.childForFieldName('body'), reading);
    return [];
  });

const reaches = ({ only, except }: Callback, action: string): boolean =>
  (only === undefined || only.includes(action)) && !except.includes(action);

type Controller = {
  readonly constant: string;
  readonly isClass: boolean;
  readonly parent: Wanted | undefined;
  readonly entries: ReadonlyArray<Entry>;
  readonly calls: ReadonlyMap<string, ReadonlyArray<string>>;
  readonly header: UnreadAccess;
};

const callsOf = (body: Node | null): ReadonlyMap<string, ReadonlyArray<string>> =>
  new Map(
    (body?.namedChildren ?? [])
      .filter(({ type }) => type === 'method')
      .map(method => [
        method.childForFieldName('name')?.text ?? '',
        namesCalledIn(method.childForFieldName('body')),
      ]),
  );

const parentOf = (definition: Node): Wanted | undefined => {
  const written = definition.childForFieldName('superclass')?.namedChildren[0];
  if (written === undefined) return undefined;
  return written.text.startsWith('::')
    ? { name: written.text.slice(2), scopes: [], ignoringCase: false }
    : { name: written.text, scopes: scopesOf(definition), ignoringCase: false };
};

const controllersIn = (
  node: Node,
  within: string | undefined,
  reading: Reading,
): ReadonlyArray<Controller> =>
  node.namedChildren.flatMap(child => {
    if (!DEFINITIONS.has(child.type)) return controllersIn(child, within, reading);
    const constant = constantWithin(child.childForFieldName('name')?.text ?? '', within);
    const body = child.childForFieldName('body');
    return [
      {
        constant,
        isClass: child.type === 'class',
        parent: parentOf(child),
        entries: entriesOf(body, reading),
        calls: callsOf(body),
        header: rowOf(child, reading.file),
      },
      ...controllersIn(child, constant, reading),
    ];
  });

const without = (
  controllers: ReadonlyMap<string, Controller>,
  constant: string,
): ReadonlyMap<string, Controller> =>
  new Map([...controllers].filter(([other]) => other !== constant));

const foundIn = (
  controllers: ReadonlyMap<string, Controller>,
  wanted: Wanted,
): string | undefined => lookedUp(wanted, classesOf([...controllers.keys()]));

const expanded = (
  controllers: ReadonlyMap<string, Controller>,
  entries: ReadonlyArray<Entry>,
): ReadonlyArray<Step> =>
  entries.flatMap(entry => {
    if (!('include' in entry)) return [entry];
    const concern = foundIn(controllers, entry.include);
    if (concern === undefined) return [{ unread: entry.at }];
    return expanded(without(controllers, concern), controllers.get(concern)?.entries ?? []);
  });

const RAILS_PARENTS: ReadonlySet<string> = new Set([
  'ActionController::Base',
  'ActionController::API',
]);

const above = (
  controllers: ReadonlyMap<string, Controller>,
  { parent, header }: Controller,
): ReadonlyArray<Step> => {
  if (parent === undefined || RAILS_PARENTS.has(parent.name)) return [];
  const found = foundIn(controllers, parent);
  return found === undefined ? [{ unread: header }] : inherited(controllers, found);
};

const inherited = (
  controllers: ReadonlyMap<string, Controller>,
  constant: string,
): ReadonlyArray<Step> => {
  const controller = controllers.get(constant);
  if (controller === undefined) return [];
  const others = without(controllers, constant);
  return [...above(others, controller), ...expanded(others, controller.entries)];
};

type Covering = {
  readonly action: string;
  readonly callbacks: ReadonlyArray<Callback>;
  readonly calls: ReadonlyArray<string>;
  readonly authorize: ReadonlyArray<string>;
};

const coverOf = ({ action, callbacks, calls, authorize }: Covering): { readonly cover?: Cover } => {
  const covers = callbacks
    .filter(callback => reaches(callback, action))
    .filter(({ after, name }) => !after || name === AFTER_THE_ACTION)
    .reduce<ReadonlyArray<Cover>>((active, { skip, name, conditional }) => {
      if (!skip) return active.concat({ by: name, conditional });
      if (!conditional) return active.filter(kept => kept.by !== name);
      return active.map(kept => (kept.by === name ? { by: name, conditional } : kept));
    }, [])
    .concat(calls.map(name => ({ by: name, conditional: false })))
    .filter(({ by }) => authorizes(authorize, by));
  const cover = covers.find(({ conditional }) => !conditional) ?? covers[0];
  return cover === undefined ? {} : { cover };
};

type ControllerFile = {
  readonly root: string;
  readonly controllers: ReadonlyArray<Controller>;
  readonly actions: ReadonlyArray<Action>;
};

const controllerPathOf = (controller: string): string =>
  controller
    .replace(/Controller$/, '')
    .replaceAll('::', '/')
    .replace(/([A-Z\d]+)(?=[A-Z][a-z])|([a-z\d])(?=[A-Z])/g, '$1$2_')
    .toLowerCase();

const fileOf = (text: string, { file, authorize }: Reading): ControllerFile => {
  const root = file.slice(0, file.indexOf('app/controllers/'));
  const { symbols } = symbolsOfRuby(text);
  const controllers = readRuby(text, program =>
    controllersIn(program, undefined, { file, authorize }),
  );
  const classes = new Set(
    controllers.filter(({ isClass }) => isClass).map(({ constant }) => constant),
  );
  return {
    root,
    controllers,
    actions: symbols.flatMap(({ name, scope, kind, exported, lines }) =>
      kind === 'method' &&
      exported &&
      scope !== undefined &&
      classes.has(scope) &&
      !name.startsWith('self.')
        ? [
            {
              controller: scope,
              controllerPath: controllerPathOf(scope),
              action: name,
              root,
              file,
              line: lines.start,
            },
          ]
        : [],
    ),
  };
};

const reopened = (first: Controller, next: Controller): Controller => ({
  ...(first.parent === undefined ? next : first),
  entries: [...first.entries, ...next.entries],
  calls: new Map([...first.calls, ...next.calls]),
});

const controllersAt = (
  read: ReadonlyArray<ControllerFile>,
  root: string,
): ReadonlyMap<string, Controller> =>
  read
    .filter(other => other.root === root)
    .flatMap(other => other.controllers)
    .reduce((found, controller) => {
      const first = found.get(controller.constant);
      return new Map(found).set(
        controller.constant,
        first === undefined ? controller : reopened(first, controller),
      );
    }, new Map<string, Controller>());

const coveredIn = (
  read: ReadonlyArray<ControllerFile>,
  authorize: ReadonlyArray<string>,
): ReadonlyArray<Action> =>
  read.flatMap(({ root, actions }) => {
    const controllers = controllersAt(read, root);
    return actions.map(action => {
      const steps = inherited(controllers, action.controller);
      const unread = steps.flatMap(step => ('unread' in step ? [step.unread] : []));
      return {
        ...action,
        ...coverOf({
          action: action.action,
          callbacks: steps.flatMap(step => ('unread' in step ? [] : [step])),
          calls: controllers.get(action.controller)?.calls.get(action.action) ?? [],
          authorize,
        }),
        ...(unread.length === 0 ? {} : { unread }),
      };
    });
  });

export const railsAccess: AccessReader = {
  holds: path =>
    CONTROLLER_FILE.test(path) && !path.split('/').some(folder => NOT_SEARCHED.has(folder)),
  actions: ({ files, authorize }) => {
    const read = [...files].map(([file, text]) => {
      try {
        return fileOf(text, { file, authorize });
      } catch (error) {
        return { file, reason: error instanceof Error ? error.message : String(error) };
      }
    });
    const notRead = read.flatMap(each => ('reason' in each ? [each] : []));
    return {
      actions: coveredIn(
        read.flatMap(each => ('reason' in each ? [] : [each])),
        authorize,
      ),
      ...(notRead.length === 0 ? {} : { notRead }),
    };
  },
};
