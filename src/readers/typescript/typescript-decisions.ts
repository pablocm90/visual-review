import type { IfStatement, Node, ThrowStatement } from '@babel/types';
import type { Decision } from '../../core/reader.ts';
import { childrenOf } from './typescript-syntax.ts';

type Token = { readonly start?: number | null; readonly end?: number | null };

export type Code = { readonly text: string; readonly tokens: ReadonlyArray<Token> };

type Piece = { readonly start: number; readonly end: number; readonly piece: string };

const OPENERS: ReadonlySet<string> = new Set(['(', '[', '{']);
const CLOSERS: ReadonlySet<string> = new Set([')', ']', '}']);

const startOf = (range: Token): number => range.start ?? 0;
const endOf = (range: Token): number => range.end ?? 0;

const spaced = (piece: Piece, before: Piece | undefined): string =>
  before !== undefined &&
  piece.start > before.end &&
  !OPENERS.has(before.piece) &&
  !CLOSERS.has(piece.piece)
    ? ` ${piece.piece}`
    : piece.piece;

const codeBetween = ({ text, tokens }: Code, start: number, end: number): string => {
  const pieces = tokens
    .filter(token => startOf(token) >= start && endOf(token) <= end)
    .map(token => ({
      start: startOf(token),
      end: endOf(token),
      piece: text.slice(startOf(token), endOf(token)),
    }));
  const kept = pieces.filter(
    ({ piece }, index) => !(piece === ',' && CLOSERS.has(pieces[index + 1]?.piece ?? '')),
  );
  return kept.map((piece, index) => spaced(piece, kept[index - 1])).join('');
};

const codeOf = (code: Code, node: Node): string => codeBetween(code, startOf(node), endOf(node));

type Walk = {
  readonly code: Code;
  readonly nested: ReadonlySet<unknown>;
  readonly depth: number;
};

const lineOf = (node: Node): number => node.loc?.start.line ?? 0;

const firstStatementOf = (node: Node): Node | undefined =>
  node.type === 'BlockStatement' ? node.body[0] : node;

const thrownBy = (code: Code, node: ThrowStatement): string =>
  node.argument.type === 'NewExpression'
    ? `throw new ${codeOf(code, node.argument.callee)}`
    : `throw ${codeOf(code, node.argument)}`;

const exitOf = (code: Code, node: Node | undefined): string | undefined => {
  if (node?.type === 'ReturnStatement') return 'return';
  return node?.type === 'ThrowStatement' ? thrownBy(code, node) : undefined;
};

const ifAt = ({ code, depth }: Walk, node: IfStatement): Decision => {
  const condition = `if (${codeOf(code, node.test)})`;
  const line = lineOf(node);
  const exit =
    node.alternate === null ? exitOf(code, firstStatementOf(node.consequent)) : undefined;
  return exit === undefined
    ? { kind: 'if', text: condition, depth, line }
    : { kind: 'guard', text: `${condition} ${exit}`, depth, line };
};

const LOGICAL_ASSIGNMENTS: ReadonlySet<string> = new Set(['&&=', '||=', '??=']);

type Head = Pick<Decision, 'kind' | 'text'>;

const loopHead = (code: Code, node: Node, body: Node): string =>
  codeBetween(code, startOf(node), startOf(body));

const headOf = (code: Code, node: Node): Head | undefined => {
  switch (node.type) {
    case 'ForStatement':
    case 'ForInStatement':
    case 'ForOfStatement':
    case 'WhileStatement':
      return { kind: 'loop', text: loopHead(code, node, node.body) };
    case 'DoWhileStatement':
      return { kind: 'loop', text: `do … while (${codeOf(code, node.test)})` };
    case 'ThrowStatement':
      return { kind: 'throw', text: thrownBy(code, node) };
    case 'CatchClause':
      return {
        kind: 'catch',
        text: node.param ? `catch (${codeOf(code, node.param)})` : 'catch',
      };
    case 'SwitchCase':
      return { kind: 'case', text: node.test ? `case ${codeOf(code, node.test)}:` : 'default:' };
    case 'LogicalExpression':
      return { kind: 'logical', text: codeOf(code, node) };
    case 'AssignmentExpression':
      return LOGICAL_ASSIGNMENTS.has(node.operator)
        ? { kind: 'logical', text: codeOf(code, node) }
        : undefined;
    case 'ConditionalExpression':
      return { kind: 'ternary', text: `${codeOf(code, node.test)} ?` };
    default:
      return undefined;
  }
};

const decisionAt = (walk: Walk, node: Node): Decision | undefined => {
  if (node.type === 'IfStatement') return ifAt(walk, node);
  if (node.type === 'ReturnStatement' && walk.depth > 0)
    return { kind: 'return', text: 'return', depth: walk.depth, line: lineOf(node) };
  const head = headOf(walk.code, node);
  return head && { ...head, depth: walk.depth, line: lineOf(node) };
};

const isElseIf = (node: Node, child: Node): boolean =>
  node.type === 'IfStatement' && node.alternate === child;

type Branch = Node | null | undefined;

const branchesOf = (node: Node): ReadonlyArray<Branch> => {
  switch (node.type) {
    case 'IfStatement':
    case 'ConditionalExpression':
      return [node.consequent, node.alternate];
    case 'ForStatement':
    case 'ForInStatement':
    case 'ForOfStatement':
    case 'WhileStatement':
    case 'DoWhileStatement':
    case 'CatchClause':
      return [node.body];
    case 'SwitchCase':
      return node.consequent;
    case 'ReturnStatement':
      return [node.argument];
    default:
      return [];
  }
};

const decisionsUnder = (
  walk: Walk,
  node: Node,
  children: ReadonlyArray<Branch> = childrenOf(node),
): ReadonlyArray<Decision> =>
  children
    .filter((child): child is Node => child != null && !walk.nested.has(child))
    .flatMap(child => {
      const at = isElseIf(node, child) ? { ...walk, depth: walk.depth - 1 } : walk;
      const own = decisionAt(at, child);
      if (own === undefined) return decisionsUnder(at, child);
      if (own.kind === 'guard') return [own];
      return [own, ...decisionsUnder({ ...at, depth: at.depth + 1 }, child, branchesOf(child))];
    });

type DecisionsOptions = {
  readonly code: Code;
  readonly node: Node;
  readonly nested: ReadonlySet<unknown>;
};

export const decisionsIn = ({ code, node, nested }: DecisionsOptions): ReadonlyArray<Decision> =>
  decisionsUnder({ code, nested, depth: 0 }, node);
