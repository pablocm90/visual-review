import type { Node } from 'web-tree-sitter';
import type { FileMeasures } from '../../core/reader.ts';
import { parseRust } from './rust-syntax.ts';

const isComment = (node: Node): boolean => node.type.endsWith('_comment');

const codeRows = (node: Node): ReadonlyArray<number> => {
  if (isComment(node)) return [];
  if (node.childCount > 0) return node.children.flatMap(codeRows);
  const { startPosition, endPosition } = node;
  return Array.from(
    { length: endPosition.row - startPosition.row + 1 },
    (_, index) => startPosition.row + index,
  );
};

export const measureRust = (text: string): FileMeasures => {
  const root = parseRust(text);
  return { lines: root === undefined ? 0 : new Set(codeRows(root)).size, functions: [] };
};
