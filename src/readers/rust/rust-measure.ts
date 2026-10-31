import type { Node } from 'web-tree-sitter';
import type { FileMeasures, FunctionMeasures } from '../../core/reader.ts';
import { codeLines } from '../tree-sitter.ts';
import { isComment, isTestCode, isTestItem, parseRust } from './rust-syntax.ts';

const isTestPart = (node: Node | null): boolean =>
  node !== null &&
  (isTestItem(node) || (node.type === 'attribute_item' && isTestPart(node.nextNamedSibling)));

const DECISIONS = new Set([
  'if_expression',
  'while_expression',
  'for_expression',
  'loop_expression',
  'match_arm',
  'try_expression',
  '&&',
  '||',
]);

const ASSIGNMENTS = new Set(['assignment_expression', 'compound_assignment_expr']);

const CALLS = new Set(['call_expression', 'macro_invocation']);

const CONDITIONS = new Set(['else_clause', 'match_arm', 'try_expression']);

const COMPARISONS = new Set(['==', '!=', '<', '>', '<=', '>=']);

const isAssignment = (node: Node): boolean =>
  ASSIGNMENTS.has(node.type) ||
  (node.type === 'let_declaration' && node.childForFieldName('value') !== null);

const isCondition = (node: Node): boolean =>
  CONDITIONS.has(node.type) || COMPARISONS.has(node.childForFieldName('operator')?.type ?? '');

const ownNodes = (node: Node): ReadonlyArray<Node> =>
  node.children.flatMap(child =>
    child.type === 'function_item' ? [] : [child, ...ownNodes(child)],
  );

const measureFunction = (item: Node): FunctionMeasures => {
  const nodes = ownNodes(item);
  return {
    name: item.childForFieldName('name')?.text ?? '',
    cyclomatic: 1 + nodes.filter(node => DECISIONS.has(node.type)).length,
    abc: {
      assignments: nodes.filter(isAssignment).length,
      branches: nodes.filter(node => CALLS.has(node.type)).length,
      conditions: nodes.filter(isCondition).length,
    },
  };
};

export const measureRust = (text: string): FileMeasures => {
  const root = parseRust(text);
  if (root === undefined) return { lines: 0, functions: [] };
  return {
    lines: codeLines(root, node => isComment(node) || isTestPart(node)),
    functions: root
      .descendantsOfType('function_item')
      .filter(item => !isTestCode(item))
      .map(measureFunction),
  };
};
