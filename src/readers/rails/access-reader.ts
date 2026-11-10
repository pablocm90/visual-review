import type { Node } from 'web-tree-sitter';
import type { AccessReader, Action, Cover, UnreadAccess } from '../../core/access.ts';
import { matchesWildcard } from '../../core/wildcard.ts';
import { classesOf, lookedUp, scopesOf, type Wanted, written } from './rails-graph.ts';
import { NOT_SEARCHED } from './reader.ts';
import { symbolsOfRuby } from './ruby-symbols.ts';
import {
  argsOf,
  constantWithin,
  methodOf,
  nameOf,
  namesIn,
  optionOf,
  readRuby,
} from './ruby-syntax.ts';

const CONTROLLER_FILE = /(^|\/)app\/controllers\/.+\.rb$/;

const DEFINITIONS: ReadonlySet<string> = new Set(['class', 'module']);

const CALLBACK = /^((prepend|append|skip)_)?(before|around|after)_action$/;

type Callback = {
  readonly skip: boolean;
  readonly name: string;
  readonly only: ReadonlyArray<string> | undefined;
  readonly except: ReadonlyArray<string>;
  readonly conditional: boolean;
};

const namesCalledIn = (node: Node | null): ReadonlyArray<string> =>
  (node?.descendantsOfType('identifier') ?? []).map(({ text }) => text);

const callbacksOfCall = (call: Node): ReadonlyArray<Callback> => {
  const args = argsOf(call);
  const only = optionOf(args, 'only');
  const except = namesIn(optionOf(args, 'except'));
  return args
    .map(nameOf)
    .concat(namesCalledIn(call.childForFieldName('block')))
    .map(name => ({
      skip: methodOf(call).startsWith('skip_'),
      name,
      only: only === undefined ? undefined : namesIn(only),
      except,
      conditional: optionOf(args, 'if') !== undefined || optionOf(args, 'unless') !== undefined,
    }));
};

type Written = { readonly text: string; readonly line: number };

type Unread = { readonly unread: UnreadAccess };

type Step = Callback | Unread;

type Entry = Step | ({ readonly include: Wanted } & Written);

type Reading = { readonly file: string; readonly authorize: ReadonlyArray<string> };

const authorizes = (authorize: ReadonlyArray<string>, name: string): boolean =>
  authorize.some(pattern => matchesWildcard(pattern, name));

const unreadable = (call: Node, authorize: ReadonlyArray<string>): boolean => {
  if (argsOf(call).some(({ type }) => type === 'splat_argument')) return true;
  const block = call.childForFieldName('block');
  return block !== null && !namesCalledIn(block).some(name => authorizes(authorize, name));
};

const unreadOf = (call: Node, { file, authorize }: Reading): ReadonlyArray<Unread> =>
  unreadable(call, authorize)
    ? [{ unread: { text: call.text, file, line: call.startPosition.row + 1 } }]
    : [];

const entriesOf = (body: Node | null | undefined, reading: Reading): ReadonlyArray<Entry> =>
  (body?.namedChildren ?? []).flatMap(node => {
    const method = methodOf(node);
    if (CALLBACK.test(method)) return [...callbacksOfCall(node), ...unreadOf(node, reading)];
    if (method === 'include')
      return argsOf(node).map(arg => ({
        include: written(arg),
        text: node.text,
        line: node.startPosition.row + 1,
      }));
    if (method === 'included')
      return entriesOf(node.childForFieldName('block')?.childForFieldName('body'), reading);
    return [];
  });

const reaches = ({ only, except }: Callback, action: string): boolean =>
  (only === undefined || only.includes(action)) && !except.includes(action);

type Controller = {
  readonly constant: string;
  readonly parent: Wanted | undefined;
  readonly entries: ReadonlyArray<Entry>;
  readonly calls: ReadonlyMap<string, ReadonlyArray<string>>;
  readonly header: string;
  readonly line: number;
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
        parent: parentOf(child),
        entries: entriesOf(body, reading),
        calls: callsOf(body),
        header: /^.*/.exec(child.text)?.[0] ?? '',
        line: child.startPosition.row + 1,
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
    if (concern === undefined) return [];
    return expanded(without(controllers, concern), controllers.get(concern)?.entries ?? []);
  });

const parentIn = (
  others: ReadonlyMap<string, Controller>,
  { parent }: Controller,
): string | undefined => parent && foundIn(others, parent);

const inherited = (
  controllers: ReadonlyMap<string, Controller>,
  constant: string,
): ReadonlyArray<Step> => {
  const controller = controllers.get(constant);
  if (controller === undefined) return [];
  const above = without(controllers, constant);
  const parent = parentIn(above, controller);
  return [
    ...(parent === undefined ? [] : inherited(above, parent)),
    ...expanded(above, controller.entries),
  ];
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
  readonly file: string;
  readonly controllers: ReadonlyArray<Controller>;
  readonly actions: ReadonlyArray<Action>;
  readonly unread: ReadonlyArray<UnreadAccess>;
};

const unreadIn = (program: Node, { file, authorize }: Reading): ReadonlyArray<UnreadAccess> =>
  program
    .descendantsOfType('call')
    .filter(call => CALLBACK.test(methodOf(call)) && unreadable(call, authorize))
    .map(call => ({ text: call.text, file, line: call.startPosition.row + 1 }));

const controllerPathOf = (controller: string): string =>
  controller
    .replace(/Controller$/, '')
    .replaceAll('::', '/')
    .replace(/([A-Z\d]+)(?=[A-Z][a-z])|([a-z\d])(?=[A-Z])/g, '$1$2_')
    .toLowerCase();

const fileOf = (text: string, { file, authorize }: Reading): ControllerFile => {
  const root = file.slice(0, file.indexOf('app/controllers/'));
  return {
    root,
    file,
    ...readRuby(text, program => ({
      controllers: controllersIn(program, undefined, { file, authorize }),
      unread: unreadIn(program, { file, authorize }),
    })),
    actions: symbolsOfRuby(text).symbols.flatMap(({ name, scope, kind, exported, lines }) =>
      kind === 'method' && exported && scope !== undefined && !name.startsWith('self.')
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

const controllersAt = (
  read: ReadonlyArray<ControllerFile>,
  root: string,
): ReadonlyMap<string, Controller> =>
  new Map(
    read
      .filter(other => other.root === root)
      .flatMap(other => other.controllers)
      .map(controller => [controller.constant, controller]),
  );

const RAILS_PARENTS: ReadonlySet<string> = new Set([
  'ActionController::Base',
  'ActionController::API',
]);

const namedOf = ({ parent, header, line, entries }: Controller) =>
  (parent === undefined || RAILS_PARENTS.has(parent.name)
    ? []
    : [{ wanted: parent, text: header, line }]
  ).concat(
    entries.flatMap(entry => ('include' in entry ? [{ ...entry, wanted: entry.include }] : [])),
  );

const lookupsUnread = (read: ReadonlyArray<ControllerFile>): ReadonlyArray<UnreadAccess> =>
  read.flatMap(({ root, file, controllers }) => {
    const all = controllersAt(read, root);
    return controllers.flatMap(controller =>
      namedOf(controller)
        .filter(({ wanted }) => foundIn(without(all, controller.constant), wanted) === undefined)
        .map(({ text, line }) => ({ text, file, line })),
    );
  });

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
    const read = [...files].map(([file, text]) => fileOf(text, { file, authorize }));
    return {
      actions: coveredIn(read, authorize),
      unread: read.flatMap(({ unread }) => unread).concat(lookupsUnread(read)),
    };
  },
};
