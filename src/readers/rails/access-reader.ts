import type { Node } from 'web-tree-sitter';
import type { AccessReader, Action, Cover } from '../../core/access.ts';
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
};

const callbacksOfCall = (call: Node): ReadonlyArray<Callback> => {
  const args = argsOf(call);
  const only = optionOf(args, 'only');
  const except = namesIn(optionOf(args, 'except'));
  return args.map(arg => ({
    skip: methodOf(call).startsWith('skip_'),
    name: nameOf(arg),
    only: only === undefined ? undefined : namesIn(only),
    except,
  }));
};

type Entry = Callback | { readonly include: Wanted };

const entriesOf = (body: Node | null | undefined): ReadonlyArray<Entry> =>
  (body?.namedChildren ?? []).flatMap(node => {
    const method = methodOf(node);
    if (CALLBACK.test(method)) return callbacksOfCall(node);
    if (method === 'include') return argsOf(node).map(arg => ({ include: written(arg) }));
    if (method === 'included')
      return entriesOf(node.childForFieldName('block')?.childForFieldName('body'));
    return [];
  });

const reaches = ({ only, except }: Callback, action: string): boolean =>
  (only === undefined || only.includes(action)) && !except.includes(action);

type Controller = {
  readonly constant: string;
  readonly parent: Wanted | undefined;
  readonly entries: ReadonlyArray<Entry>;
  readonly calls: ReadonlyMap<string, ReadonlyArray<string>>;
};

const callsOf = (body: Node | null): ReadonlyMap<string, ReadonlyArray<string>> =>
  new Map(
    (body?.namedChildren ?? [])
      .filter(({ type }) => type === 'method')
      .map(method => [
        method.childForFieldName('name')?.text ?? '',
        method.descendantsOfType('call').map(methodOf),
      ]),
  );

const parentOf = (definition: Node): Wanted | undefined => {
  const written = definition.childForFieldName('superclass')?.namedChildren[0];
  if (written === undefined) return undefined;
  return written.text.startsWith('::')
    ? { name: written.text.slice(2), scopes: [], ignoringCase: false }
    : { name: written.text, scopes: scopesOf(definition), ignoringCase: false };
};

const controllersIn = (node: Node, within: string | undefined): ReadonlyArray<Controller> =>
  node.namedChildren.flatMap(child => {
    if (!DEFINITIONS.has(child.type)) return controllersIn(child, within);
    const constant = constantWithin(child.childForFieldName('name')?.text ?? '', within);
    const body = child.childForFieldName('body');
    return [
      { constant, parent: parentOf(child), entries: entriesOf(body), calls: callsOf(body) },
      ...controllersIn(child, constant),
    ];
  });

const without = (
  controllers: ReadonlyMap<string, Controller>,
  constant: string,
): ReadonlyMap<string, Controller> =>
  new Map([...controllers].filter(([other]) => other !== constant));

const expanded = (
  controllers: ReadonlyMap<string, Controller>,
  entries: ReadonlyArray<Entry>,
): ReadonlyArray<Callback> =>
  entries.flatMap(entry => {
    if (!('include' in entry)) return [entry];
    const concern = lookedUp(entry.include, classesOf([...controllers.keys()]));
    if (concern === undefined) return [];
    return expanded(without(controllers, concern), controllers.get(concern)?.entries ?? []);
  });

const inherited = (
  controllers: ReadonlyMap<string, Controller>,
  constant: string,
): ReadonlyArray<Callback> => {
  const controller = controllers.get(constant);
  if (controller === undefined) return [];
  const above = without(controllers, constant);
  const parent = controller.parent && lookedUp(controller.parent, classesOf([...above.keys()]));
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
  const by = callbacks
    .filter(callback => reaches(callback, action))
    .reduce<ReadonlyArray<string>>(
      (active, { skip, name }) =>
        skip ? active.filter(kept => kept !== name) : active.concat(name),
      [],
    )
    .concat(calls)
    .find(name => authorize.includes(name));
  return by === undefined ? {} : { cover: { by, conditional: false } };
};

type ControllerFile = {
  readonly root: string;
  readonly controllers: ReadonlyArray<Controller>;
  readonly actions: ReadonlyArray<Action>;
};

const fileOf = (file: string, text: string): ControllerFile => {
  const root = file.slice(0, file.indexOf('app/controllers/'));
  return {
    root,
    controllers: readRuby(text, program => controllersIn(program, undefined)),
    actions: symbolsOfRuby(text).symbols.flatMap(({ name, scope, kind, exported, lines }) =>
      kind === 'method' && exported && scope !== undefined && !name.startsWith('self.')
        ? [{ controller: scope, action: name, root, file, line: lines.start }]
        : [],
    ),
  };
};

const coveredIn = (
  read: ReadonlyArray<ControllerFile>,
  authorize: ReadonlyArray<string>,
): ReadonlyArray<Action> =>
  read.flatMap(({ root, actions }) => {
    const controllers = new Map(
      read
        .filter(other => other.root === root)
        .flatMap(other => other.controllers)
        .map(controller => [controller.constant, controller]),
    );
    return actions.map(action => ({
      ...action,
      ...coverOf({
        action: action.action,
        callbacks: inherited(controllers, action.controller),
        calls: controllers.get(action.controller)?.calls.get(action.action) ?? [],
        authorize,
      }),
    }));
  });

export const railsAccess: AccessReader = {
  holds: path =>
    CONTROLLER_FILE.test(path) && !path.split('/').some(folder => NOT_SEARCHED.has(folder)),
  actions: ({ files, authorize }) => ({
    actions: coveredIn(
      [...files].map(([file, text]) => fileOf(file, text)),
      authorize,
    ),
    unread: [],
  }),
};
