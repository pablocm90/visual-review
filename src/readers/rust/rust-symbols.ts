import type { Node } from 'web-tree-sitter';
import type { FileSymbols, ReadSymbol } from '../../core/reader.ts';
import { isTooBig, TOO_BIG } from '../too-big.ts';
import { hashesOf, hashOf, shapeOf } from '../tree-sitter.ts';
import { isComment, parseRust } from './rust-syntax.ts';

const isExactlyPub = (item: Node): boolean => item.namedChildren[0]?.text === 'pub';

const collapsed = (text: string): string => text.replace(/\s+/g, ' ');

const writtenIn = (list: Node | null): string =>
  (list?.namedChildren ?? [])
    .filter(child => !isComment(child))
    .map(({ text }) => collapsed(text))
    .join(', ');

const signatureOf = (item: Node): string => {
  const modifiers = item.namedChildren.find(({ type }) => type === 'function_modifiers');
  const generics = item.childForFieldName('type_parameters');
  const returned = item.childForFieldName('return_type');
  const bounds = item.namedChildren.find(({ type }) => type === 'where_clause');
  return [
    ...(modifiers === undefined ? [] : [modifiers.text]),
    `${generics === null ? '' : `<${writtenIn(generics)}>`}(${writtenIn(item.childForFieldName('parameters'))})`,
    ...(returned === null ? [] : [`-> ${collapsed(returned.text)}`]),
    ...(bounds === undefined ? [] : [`where ${writtenIn(bounds)}`]),
  ].join(' ');
};

const functionSymbol = (item: Node): ReadSymbol => ({
  name: item.childForFieldName('name')?.text ?? '',
  kind: 'function',
  exported: isExactlyPub(item),
  signature: signatureOf(item),
  ...hashesOf({ signed: [], body: [item], text: item.text }),
});

export const symbolsOfRust = (text: string): FileSymbols => {
  if (isTooBig(text)) throw new Error(TOO_BIG);
  const root = parseRust(text);
  if (root === undefined || root.hasError) throw new Error('Rust that does not parse');
  return {
    symbols: root.namedChildren.filter(({ type }) => type === 'function_item').map(functionSymbol),
    exports: [],
    astHash: hashOf(shapeOf(root)),
  };
};
