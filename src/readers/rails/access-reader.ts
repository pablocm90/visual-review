import type { Node } from 'web-tree-sitter';
import type { AccessReader, Action, Cover } from '../../core/access.ts';
import { classesOf, lookedUp, scopesOf, type Wanted } from './rails-graph.ts';
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

const callbacksOf = (definition: Node): ReadonlyArray<Callback> =>
  (definition.childForFieldName('body')?.namedChildren ?? [])
    .filter(node => CALLBACK.test(methodOf(node)))
    .flatMap(callbacksOfCall);

const reaches = ({ only, except }: Callback, action: string): boolean =>
  (only === undefined || only.includes(action)) && !except.includes(action);

type Controller = {
  readonly constant: string;
  readonly parent: Wanted | undefined;
  readonly callbacks: ReadonlyArray<Callback>;
};

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
    return [
      { constant, parent: parentOf(child), callbacks: callbacksOf(child) },
      ...controllersIn(child, constant),
    ];
  });

const inherited = (
  controllers: ReadonlyMap<string, Controller>,
  constant: string,
): ReadonlyArray<Callback> => {
  const controller = controllers.get(constant);
  if (controller === undefined) return [];
  const parent =
    controller.parent && lookedUp(controller.parent, classesOf([...controllers.keys()]));
  return [...(parent === undefined ? [] : inherited(controllers, parent)), ...controller.callbacks];
};

const coverOf = (
  action: string,
  callbacks: ReadonlyArray<Callback>,
  authorize: ReadonlyArray<string>,
): { readonly cover?: Cover } => {
  const by = callbacks
    .filter(callback => reaches(callback, action))
    .reduce<ReadonlyArray<string>>(
      (active, { skip, name }) =>
        skip ? active.filter(kept => kept !== name) : active.concat(name),
      [],
    )
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
      ...coverOf(action.action, inherited(controllers, action.controller), authorize),
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
