import type { Node } from 'web-tree-sitter';
import type { FileMeasures, FunctionMeasures } from '../../core/reader.ts';
import { codeLines } from '../tree-sitter.ts';
import { parseRuby } from './ruby-syntax.ts';

const METHODS = ['method', 'singleton_method'];

const nameOf = (method: Node): string => {
  const name = method.childForFieldName('name')?.text ?? '';
  const object = method.childForFieldName('object');
  return object === null ? name : `${object.text}.${name}`;
};

const DECISIONS = new Set([
  'if',
  'unless',
  'elsif',
  'if_modifier',
  'unless_modifier',
  'conditional',
  'while',
  'until',
  'while_modifier',
  'until_modifier',
  'for',
  'when',
  'in_clause',
  'rescue',
  'rescue_modifier',
]);

const DECIDING_TOKENS = new Set(['&&', '||', 'and', 'or', '||=', '&&=', '&.']);

const isDecision = (node: Node): boolean =>
  node.isNamed ? DECISIONS.has(node.type) : DECIDING_TOKENS.has(node.type);

const ownNodes = (node: Node): ReadonlyArray<Node> =>
  node.children.flatMap(child => (METHODS.includes(child.type) ? [] : [child, ...ownNodes(child)]));

const ASSIGNMENTS = new Set(['assignment', 'operator_assignment']);

const isSetter = (call: Node): boolean =>
  call.parent?.type === 'left_assignment_list' ||
  (ASSIGNMENTS.has(call.parent?.type ?? '') &&
    call.parent?.childForFieldName('left')?.id === call.id);

const isCalledSuper = (node: Node): boolean =>
  node.parent?.type === 'call' && node.parent.childForFieldName('method')?.id === node.id;

const isBranch = (node: Node): boolean =>
  node.isNamed &&
  ((node.type === 'call' && !isSetter(node)) ||
    node.type === 'yield' ||
    (node.type === 'super' && !isCalledSuper(node)));

const COMPARISONS = new Set(['==', '===', '!=', '<', '>', '<=', '>=', '<=>']);

const CONDITIONS = new Set([
  'else',
  'elsif',
  'when',
  'in_clause',
  'rescue',
  'rescue_modifier',
  'conditional',
]);

const isCondition = (node: Node): boolean =>
  node.isNamed
    ? CONDITIONS.has(node.type)
    : node.type === '&.' || (node.parent?.type === 'binary' && COMPARISONS.has(node.type));

const measureMethod = (method: Node): FunctionMeasures => {
  const nodes = ownNodes(method);
  return {
    name: nameOf(method),
    cyclomatic: 1 + nodes.filter(isDecision).length,
    abc: {
      assignments: nodes.filter(node => ASSIGNMENTS.has(node.type)).length,
      branches: nodes.filter(isBranch).length,
      conditions: nodes.filter(isCondition).length,
    },
  };
};

export const measureRuby = (text: string): FileMeasures | undefined => {
  const program = parseRuby(text);
  if (program === undefined) return undefined;
  return {
    lines: codeLines(program, node => node.type === 'comment'),
    functions: program.descendantsOfType(METHODS).map(measureMethod),
  };
};
