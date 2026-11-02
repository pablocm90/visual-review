import type { Node } from '@babel/types';
import type { FileMeasures } from '../../core/reader.ts';
import { childrenOf, functionsIn, parseTypeScript } from './typescript-syntax.ts';

type Row = { readonly line: number };

type Token = {
  readonly type: string | { readonly label: string };
  readonly loc: { readonly start: Row; readonly end: Row };
};

const isRow = (value: unknown): value is Row =>
  typeof value === 'object' && value !== null && 'line' in value && typeof value.line === 'number';

const isLabel = (value: unknown): value is { readonly label: string } =>
  typeof value === 'object' &&
  value !== null &&
  'label' in value &&
  typeof value.label === 'string';

const isLoc = (value: unknown): value is Token['loc'] =>
  typeof value === 'object' &&
  value !== null &&
  'start' in value &&
  isRow(value.start) &&
  'end' in value &&
  isRow(value.end);

const isToken = (value: unknown): value is Token =>
  typeof value === 'object' &&
  value !== null &&
  'type' in value &&
  (typeof value.type === 'string' || isLabel(value.type)) &&
  'loc' in value &&
  isLoc(value.loc);

const NOT_CODE = new Set(['CommentLine', 'CommentBlock', 'eof']);

const isCode = ({ type }: Token): boolean =>
  !NOT_CODE.has(typeof type === 'string' ? type : type.label);

const rowsOf = ({ loc: { start, end } }: Token): ReadonlyArray<number> =>
  Array.from({ length: end.line - start.line + 1 }, (_, index) => start.line + index);

const DECISIONS = new Set([
  'IfStatement',
  'ConditionalExpression',
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'WhileStatement',
  'DoWhileStatement',
  'CatchClause',
  'LogicalExpression',
  'AssignmentPattern',
]);

const LOGICAL_ASSIGNMENTS = new Set(['&&=', '||=', '??=']);

const isOptionalLink = (node: Node): boolean =>
  (node.type === 'OptionalMemberExpression' || node.type === 'OptionalCallExpression') &&
  node.optional;

const isCase = (node: Node): boolean => node.type === 'SwitchCase' && node.test !== null;

const isDecision = (node: Node): boolean =>
  DECISIONS.has(node.type) ||
  isCase(node) ||
  (node.type === 'AssignmentExpression' && LOGICAL_ASSIGNMENTS.has(node.operator)) ||
  isOptionalLink(node);

const isAssignment = (node: Node): boolean =>
  node.type === 'AssignmentExpression' ||
  node.type === 'UpdateExpression' ||
  (node.type === 'VariableDeclarator' && node.init !== null);

const CALLS = new Set(['CallExpression', 'OptionalCallExpression', 'NewExpression']);

const COMPARISONS = new Set(['==', '!=', '===', '!==', '<', '>', '<=', '>=']);

const CONDITIONS = new Set(['CatchClause', 'ConditionalExpression', 'SwitchCase']);

const isCondition = (node: Node): boolean =>
  CONDITIONS.has(node.type) ||
  isOptionalLink(node) ||
  (node.type === 'IfStatement' && node.alternate !== null) ||
  (node.type === 'BinaryExpression' && COMPARISONS.has(node.operator));

const ownNodes = (node: Node, functions: ReadonlySet<Node>): ReadonlyArray<Node> =>
  childrenOf(node).flatMap(child =>
    functions.has(child) ? [] : [child, ...ownNodes(child, functions)],
  );

const MOST_CHARACTERS = 262_144;

const LONGEST_LINE = 1000;

const isTooBig = (text: string): boolean =>
  text.length > MOST_CHARACTERS || text.split('\n').some(line => line.length > LONGEST_LINE);

export const measureTypeScript = (text: string, path: string): FileMeasures | undefined => {
  if (isTooBig(text)) return undefined;
  const { program, tokens } = parseTypeScript(text, path);
  const tokenList: ReadonlyArray<unknown> = tokens ?? [];
  const code = tokenList.filter(isToken).filter(isCode);
  const functions = functionsIn(text, program);
  const bodies = new Set(functions.map(({ node }) => node));
  return {
    lines: new Set(code.flatMap(rowsOf)).size,
    functions: functions.map(({ symbol: { name }, node }) => {
      const nodes = ownNodes(node, bodies);
      return {
        name,
        cyclomatic: 1 + nodes.filter(isDecision).length,
        abc: {
          assignments: nodes.filter(isAssignment).length,
          branches: nodes.filter(node => CALLS.has(node.type)).length,
          conditions: nodes.filter(isCondition).length,
        },
      };
    }),
  };
};
