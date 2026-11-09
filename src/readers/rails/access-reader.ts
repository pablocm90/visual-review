import type { Node } from 'web-tree-sitter';
import type { AccessReader, Action, Cover } from '../../core/access.ts';
import { NOT_SEARCHED } from './reader.ts';
import { symbolsOfRuby } from './ruby-symbols.ts';
import { argsOf, constantWithin, methodOf, nameOf, readRuby } from './ruby-syntax.ts';

const CONTROLLER_FILE = /(^|\/)app\/controllers\/.+\.rb$/;

const DEFINITIONS: ReadonlySet<string> = new Set(['class', 'module']);

const callbacksOf = (definition: Node): ReadonlyArray<string> =>
  (definition.childForFieldName('body')?.namedChildren ?? [])
    .filter(node => methodOf(node) === 'before_action')
    .flatMap(call => argsOf(call).map(nameOf));

const callbacksIn = (
  node: Node,
  within: string | undefined,
): ReadonlyArray<[string, ReadonlyArray<string>]> =>
  node.namedChildren.flatMap(child => {
    if (!DEFINITIONS.has(child.type)) return callbacksIn(child, within);
    const constant = constantWithin(child.childForFieldName('name')?.text ?? '', within);
    return [[constant, callbacksOf(child)], ...callbacksIn(child, constant)];
  });

const coverOf = (
  callbacks: ReadonlyArray<string>,
  authorize: ReadonlyArray<string>,
): { readonly cover?: Cover } => {
  const by = callbacks.find(name => authorize.includes(name));
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
            ...coverOf(callbacks.get(scope) ?? [], authorize),
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
