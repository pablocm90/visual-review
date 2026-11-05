import type { Node } from 'web-tree-sitter';
import type { FileSymbols, ReadSymbol } from '../../core/reader.ts';
import { hashesOf, hashOf, shapeOf } from '../tree-sitter.ts';
import { parseRust } from './rust-syntax.ts';

const isExactlyPub = (item: Node): boolean => item.namedChildren[0]?.text === 'pub';

const functionSymbol = (item: Node): ReadSymbol => ({
  name: item.childForFieldName('name')?.text ?? '',
  kind: 'function',
  exported: isExactlyPub(item),
  signature: '',
  ...hashesOf({ signed: [], body: [item], text: item.text }),
});

export const symbolsOfRust = (text: string): FileSymbols => {
  const root = parseRust(text);
  if (root === undefined) throw new Error('Rust that does not parse');
  return {
    symbols: root.namedChildren.filter(({ type }) => type === 'function_item').map(functionSymbol),
    exports: [],
    astHash: hashOf(shapeOf(root)),
  };
};
