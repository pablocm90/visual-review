import type { Node } from 'web-tree-sitter';
import type { FileSymbols, ReadSymbol } from '../../core/reader.ts';
import { isTooBig, TOO_BIG } from '../too-big.ts';
import { hashesOf, hashOf, isComment, shapeOf } from '../tree-sitter.ts';
import { attributesOf, isDocText, parseRust, pathOf } from './rust-syntax.ts';

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

const cfgsOf = (item: Node): ReadonlyArray<Node> =>
  attributesOf(item).filter(attribute => pathOf(attribute) === 'cfg');

const signatureOf = (item: Node): string => {
  const { modifiers, generics, parameters, returned, bounds } = signedPartsOf(item);
  return [
    ...cfgsOf(item).map(({ text }) => collapsed(text)),
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
      signed: [...cfgsOf(item), ...present(Object.values(signedPartsOf(item)))],
      body: [
        ...attributes.filter(attribute => !isDocText(attribute)),
        ...present([childOfType(item, 'visibility_modifier'), item.childForFieldName('body')]),
      ],
      text: [...attributes, item].map(({ text }) => text).join('\n'),
    }),
  };
};

const FUNCTIONS: ReadonlySet<string> = new Set(['function_item', 'function_signature_item']);

const functionsIn = (item: Node): ReadonlyArray<ReadSymbol> =>
  (item.childForFieldName('body')?.namedChildren ?? [])
    .filter(({ type }) => FUNCTIONS.has(type))
    .map(functionSymbol);

const typeOfImpl = (item: Node): string => {
  const type = item.childForFieldName('type');
  return (type?.childForFieldName('type') ?? type)?.text ?? '';
};

const isPubBeside = (item: Node, name: string): boolean =>
  (item.parent?.namedChildren ?? []).some(
    sibling => sibling.childForFieldName('name')?.text === name && isExactlyPub(sibling),
  );

const methodsOfImpl = (item: Node): ReadonlyArray<ReadSymbol> => {
  const type = typeOfImpl(item);
  const trait = item.childForFieldName('trait');
  const place =
    trait === null
      ? { scope: type }
      : { scope: collapsed(`${type} as ${trait.text}`), exported: isPubBeside(item, type) };
  return functionsIn(item).map(method => ({ ...method, kind: 'method', ...place }));
};

const methodsOfTrait = (item: Node): ReadonlyArray<ReadSymbol> =>
  functionsIn(item).map(method => ({
    ...method,
    kind: 'method',
    scope: item.childForFieldName('name')?.text ?? '',
    exported: isExactlyPub(item),
  }));

const symbolsOfItem = (item: Node): ReadonlyArray<ReadSymbol> => {
  if (item.type === 'function_item') return [functionSymbol(item)];
  if (item.type === 'trait_item') return methodsOfTrait(item);
  return item.type === 'impl_item' ? methodsOfImpl(item) : [];
};

export const symbolsOfRust = (text: string): FileSymbols => {
  if (isTooBig(text)) throw new Error(TOO_BIG);
  const root = parseRust(text);
  if (root === undefined || root.hasError) throw new Error('Rust that does not parse');
  return {
    symbols: root.namedChildren.flatMap(symbolsOfItem),
    exports: [],
    astHash: hashOf(shapeOf(root)),
  };
};
