import type { Node } from 'web-tree-sitter';
import { parserOf } from '../tree-sitter.ts';

export const parseRuby = await parserOf('tree-sitter-ruby');

export const nameOf = (node: Node | undefined): string =>
  node?.text.replace(/^:?['"]?|['"]$/g, '') ?? '';

export const writtenIn = ({ namedChildren }: Node): ReadonlyArray<Node> =>
  namedChildren.filter(({ type }) => type !== 'comment');

export const isOption = ({ type }: Node): boolean => type === 'pair' || type === 'hash';

export const positional = (args: ReadonlyArray<Node>): ReadonlyArray<Node> =>
  args.filter(arg => !isOption(arg));

export const methodOf = (call: Node): string => call.childForFieldName('method')?.text ?? '';

export const argsOf = (call: Node): ReadonlyArray<Node> => {
  const args = call.childForFieldName('arguments');
  return args === null ? [] : writtenIn(args);
};

export const blockParameterOf = (call: Node): string | undefined =>
  call.childForFieldName('block')?.childForFieldName('parameters')?.namedChildren[0]?.text;
