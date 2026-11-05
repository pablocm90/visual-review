import type { Node } from 'web-tree-sitter';
import type { FileSymbols, ReadSymbol } from '../../core/reader.ts';
import { isTooBig, TOO_BIG } from '../too-big.ts';
import { hashesOf, hashOf, isComment, shapeOf } from '../tree-sitter.ts';
import { attributesOf, isDocText, parseRust } from './rust-syntax.ts';

const isExactlyPub = (item: Node): boolean => item.namedChildren[0]?.text === 'pub';

const collapsed = (text: string): string => text.replace(/\s+/g, ' ');

const writtenIn = (list: Node | null): string =>
  (list?.namedChildren ?? [])
    .filter(child => !isComment(child))
    .map(({ text }) => collapsed(text))
    .join(', ');

const childOfType = (item: Node, wanted: string): Node | null =>
  item.namedChildren.find(({ type }) => type === wanted) ?? null;

const signedPartsOf = (item: Node) => ({
  modifiers: childOfType(item, 'function_modifiers'),
  generics: item.childForFieldName('type_parameters'),
  parameters: item.childForFieldName('parameters'),
  returned: item.childForFieldName('return_type'),
  bounds: childOfType(item, 'where_clause'),
});

const signatureOf = (item: Node): string => {
  const { modifiers, generics, parameters, returned, bounds } = signedPartsOf(item);
  return [
    ...(modifiers === null ? [] : [modifiers.text]),
    `${generics === null ? '' : `<${writtenIn(generics)}>`}(${writtenIn(parameters)})`,
    ...(returned === null ? [] : [`-> ${collapsed(returned.text)}`]),
    ...(bounds === null ? [] : [`where ${writtenIn(bounds)}`]),
  ].join(' ');
};

const present = (nodes: ReadonlyArray<Node | null>): ReadonlyArray<Node> =>
  nodes.filter(node => node !== null);

const functionSymbol = (item: Node): ReadSymbol => {
  const attributes = attributesOf(item);
  return {
    name: item.childForFieldName('name')?.text ?? '',
    kind: 'function',
    exported: isExactlyPub(item),
    signature: signatureOf(item),
    ...hashesOf({
      signed: present(Object.values(signedPartsOf(item))),
      body: [
        ...attributes.filter(attribute => !isDocText(attribute)),
        ...present([childOfType(item, 'visibility_modifier'), item.childForFieldName('body')]),
      ],
      text: [...attributes, item].map(({ text }) => text).join('\n'),
    }),
  };
};

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
