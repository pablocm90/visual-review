import type { Node } from 'web-tree-sitter';
import type { FileMeasures, FunctionMeasures } from '../../core/reader.ts';
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

const measureFunction = (item: Node): FunctionMeasures => ({
  name: item.childForFieldName('name')?.text ?? '',
  cyclomatic: 1,
  abc: { assignments: 0, branches: 0, conditions: 0 },
});

export const measureRust = (text: string): FileMeasures => {
  const root = parseRust(text);
  if (root === undefined) return { lines: 0, functions: [] };
  return {
    lines: new Set(codeRows(root)).size,
    functions: root.descendantsOfType('function_item').map(measureFunction),
  };
};
