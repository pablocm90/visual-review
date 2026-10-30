import type { Node } from 'web-tree-sitter';
import type { FileMeasures, FunctionMeasures } from '../../core/reader.ts';
import { isTestCode, parseRust } from './rust-syntax.ts';

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

const BRANCHES = new Set([
  'if_expression',
  'while_expression',
  'for_expression',
  'loop_expression',
  'match_arm',
  'try_expression',
  '&&',
  '||',
]);

const ownNodes = (node: Node): ReadonlyArray<Node> =>
  node.children.flatMap(child =>
    child.type === 'function_item' ? [] : [child, ...ownNodes(child)],
  );

const measureFunction = (item: Node): FunctionMeasures => ({
  name: item.childForFieldName('name')?.text ?? '',
  cyclomatic: 1 + ownNodes(item).filter(node => BRANCHES.has(node.type)).length,
  abc: { assignments: 0, branches: 0, conditions: 0 },
});

export const measureRust = (text: string): FileMeasures => {
  const root = parseRust(text);
  if (root === undefined) return { lines: 0, functions: [] };
  return {
    lines: new Set(codeRows(root)).size,
    functions: root
      .descendantsOfType('function_item')
      .filter(item => !isTestCode(item))
      .map(measureFunction),
  };
};
