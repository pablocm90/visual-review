import { createRequire } from 'node:module';
import { Language, type Node, Parser } from 'web-tree-sitter';

await Parser.init();
const parser = new Parser();
parser.setLanguage(
  await Language.load(
    createRequire(import.meta.url).resolve('tree-sitter-rust/tree-sitter-rust.wasm'),
  ),
);

export const parseRust = (text: string): Node | undefined => parser.parse(text)?.rootNode;

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
