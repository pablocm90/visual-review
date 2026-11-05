import type { Node } from 'web-tree-sitter';
import type { FileSymbols, ReadSymbol } from '../../core/reader.ts';
import { isTooBig, TOO_BIG } from '../too-big.ts';
import { parseRuby } from './ruby-syntax.ts';

const DEFINITIONS = new Set(['class', 'module']);

const constantWithin = (definition: Node, within: string | undefined): string => {
  const written = definition.childForFieldName('name')?.text ?? '';
  if (written.startsWith('::')) return written.slice(2);
  return within === undefined ? written : `${within}::${written}`;
};

const signatureOf = (definition: Node): string =>
  definition.childForFieldName('superclass')?.text ?? '';

const symbolsWithin = (node: Node, within?: string): ReadonlyArray<ReadSymbol> => {
  if (!DEFINITIONS.has(node.type))
    return node.namedChildren.flatMap(child => symbolsWithin(child, within));
  const constant = constantWithin(node, within);
  return [
    {
      name: constant,
      kind: 'class',
      exported: true,
      signature: signatureOf(node),
      signatureHash: '',
      bodyHash: '',
      textHash: '',
      bodyTokens: [],
    },
    ...node.namedChildren.flatMap(child => symbolsWithin(child, constant)),
  ];
};

export const symbolsOfRuby = (text: string): FileSymbols => {
  if (isTooBig(text)) throw new Error(TOO_BIG);
  const program = parseRuby(text);
  if (program === undefined || program.hasError) throw new Error('Ruby that does not parse');
  return { symbols: symbolsWithin(program), exports: [], astHash: '' };
};
