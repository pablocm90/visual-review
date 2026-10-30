import type { Node } from 'web-tree-sitter';
import { parserOf } from '../tree-sitter.ts';

export const parseRust = await parserOf('tree-sitter-rust');

type Item = { readonly node: Node; readonly attributes: ReadonlyArray<Node> };

export const itemsIn = (list: Node): ReadonlyArray<Item> =>
  list.namedChildren.reduce<{
    readonly items: ReadonlyArray<Item>;
    readonly attributes: ReadonlyArray<Node>;
  }>(
    ({ items, attributes }, child) =>
      child.type === 'attribute_item'
        ? { items, attributes: [...attributes, child] }
        : { items: [...items, { node: child, attributes }], attributes: [] },
    { items: [], attributes: [] },
  ).items;

export const attributeOf = (item: Node) => item.namedChildren[0];

export const isCfgTest = (item: Node): boolean => attributeOf(item)?.text === 'cfg(test)';

export const pathOf = (item: Node) => attributeOf(item)?.namedChildren[0]?.text;

export const isTestAttribute = (item: Node): boolean => pathOf(item)?.split('::').at(-1) === 'test';

const attributesOf = (item: Node): ReadonlyArray<Node> => {
  const previous = item.previousNamedSibling;
  return previous?.type === 'attribute_item' ? [...attributesOf(previous), previous] : [];
};

export const isTestCode = (node: Node): boolean =>
  attributesOf(node).some(attribute => isTestAttribute(attribute) || isCfgTest(attribute)) ||
  (node.parent !== null && isTestCode(node.parent));
