import type { Node } from 'web-tree-sitter';
import type { FileMeasures } from '../../core/reader.ts';
import { parseRuby } from './ruby-syntax.ts';

const codeRows = (node: Node): ReadonlyArray<number> => {
  if (node.type === 'comment') return [];
  if (node.childCount > 0) return node.children.flatMap(codeRows);
  const { startPosition, endPosition } = node;
  return Array.from(
    { length: endPosition.row - startPosition.row + 1 },
    (_, index) => startPosition.row + index,
  );
};

export const measureRuby = (text: string): FileMeasures | undefined => {
  const program = parseRuby(text);
  if (program === undefined) return undefined;
  return { lines: new Set(codeRows(program)).size, functions: [] };
};
