import { createRequire } from 'node:module';
import { Language, type Node, Parser } from 'web-tree-sitter';

await Parser.init();

export const parserOf = async (grammar: string): Promise<(text: string) => Node | undefined> => {
  const parser = new Parser();
  parser.setLanguage(
    await Language.load(createRequire(import.meta.url).resolve(`${grammar}/${grammar}.wasm`)),
  );
  return text => parser.parse(text)?.rootNode;
};

export const codeLines = (root: Node, isSkipped: (node: Node) => boolean): number => {
  const rows = (node: Node): ReadonlyArray<number> => {
    if (isSkipped(node)) return [];
    if (node.childCount > 0) return node.children.flatMap(rows);
    const { startPosition, endPosition } = node;
    return Array.from(
      { length: endPosition.row - startPosition.row + 1 },
      (_, index) => startPosition.row + index,
    );
  };
  return new Set(root.children.flatMap(rows)).size;
};
