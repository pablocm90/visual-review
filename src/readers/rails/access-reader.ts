import type { Node } from 'web-tree-sitter';
import type { AccessReader, Action, Cover } from '../../core/access.ts';
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

const CALLBACKS: ReadonlySet<string> = new Set(['before_action', 'skip_before_action']);

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
    skip: methodOf(call) === 'skip_before_action',
    name: nameOf(arg),
    only: only === undefined ? undefined : namesIn(only),
    except,
  }));
};

const callbacksOf = (definition: Node): ReadonlyArray<Callback> =>
  (definition.childForFieldName('body')?.namedChildren ?? [])
    .filter(node => CALLBACKS.has(methodOf(node)))
    .flatMap(callbacksOfCall);

const reaches = ({ only, except }: Callback, action: string): boolean =>
  (only === undefined || only.includes(action)) && !except.includes(action);

const callbacksIn = (
  node: Node,
  within: string | undefined,
): ReadonlyArray<[string, ReadonlyArray<Callback>]> =>
  node.namedChildren.flatMap(child => {
    if (!DEFINITIONS.has(child.type)) return callbacksIn(child, within);
    const constant = constantWithin(child.childForFieldName('name')?.text ?? '', within);
    return [[constant, callbacksOf(child)], ...callbacksIn(child, constant)];
  });

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

const actionsIn = (
  file: string,
  text: string,
  authorize: ReadonlyArray<string>,
): ReadonlyArray<Action> => {
  const root = file.slice(0, file.indexOf('app/controllers/'));
  const callbacks = new Map(readRuby(text, program => callbacksIn(program, undefined)));
  return symbolsOfRuby(text).symbols.flatMap(({ name, scope, kind, exported, lines }) =>
    kind === 'method' && exported && scope !== undefined && !name.startsWith('self.')
      ? [
          {
            controller: scope,
            action: name,
            root,
            file,
            line: lines.start,
            ...coverOf(name, callbacks.get(scope) ?? [], authorize),
          },
        ]
      : [],
  );
};

export const railsAccess: AccessReader = {
  holds: path =>
    CONTROLLER_FILE.test(path) && !path.split('/').some(folder => NOT_SEARCHED.has(folder)),
  actions: ({ files, authorize }) => ({
    actions: [...files].flatMap(([file, text]) => actionsIn(file, text, authorize)),
    unread: [],
  }),
};
