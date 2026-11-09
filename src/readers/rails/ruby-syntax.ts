import type { Node } from 'web-tree-sitter';
import { parserOf } from '../tree-sitter.ts';

const ruby = await parserOf('tree-sitter-ruby');

export const parseRuby = ruby.parse;

export const readRuby = ruby.read;

export const parsingRuby = ruby.parsing;

export const nameOf = (node: Node | undefined): string =>
  node?.text.replace(/^:?['"]?|['"]$/g, '') ?? '';

export const writtenIn = ({ namedChildren }: Node): ReadonlyArray<Node> =>
  namedChildren.filter(({ type }) => type !== 'comment');

const OPTIONS: ReadonlySet<string> = new Set(['pair', 'hash', 'hash_splat_argument']);

export const isOption = ({ type }: Node): boolean => OPTIONS.has(type);

export const positional = (args: ReadonlyArray<Node>): ReadonlyArray<Node> =>
  args.filter(arg => !isOption(arg));

const LISTS: ReadonlySet<string> = new Set(['array', 'symbol_array', 'string_array']);

export const isNameList = ({ type }: Node): boolean => LISTS.has(type);

export const namesIn = (node: Node | undefined): ReadonlyArray<string> =>
  node !== undefined && LISTS.has(node.type) ? writtenIn(node).map(nameOf) : [nameOf(node)];

const pairsOf = (arg: Node): ReadonlyArray<Node> => {
  if (arg.type === 'pair') return [arg];
  return arg.type === 'hash' ? arg.namedChildren : [];
};

export const optionOf = (args: ReadonlyArray<Node>, key: string): Node | undefined =>
  args
    .flatMap(pairsOf)
    .find(pair => nameOf(pair.childForFieldName('key') ?? undefined) === key)
    ?.childForFieldName('value') ?? undefined;

export const methodOf = (call: Node): string => call.childForFieldName('method')?.text ?? '';

export const argsOf = (call: Node): ReadonlyArray<Node> => {
  const args = call.childForFieldName('arguments');
  return args === null ? [] : writtenIn(args);
};

export const blockParameterOf = (call: Node): string | undefined =>
  call.childForFieldName('block')?.childForFieldName('parameters')?.namedChildren[0]?.text;
