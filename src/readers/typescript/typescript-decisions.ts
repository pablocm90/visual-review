import type { IfStatement, Node, ThrowStatement } from '@babel/types';
import type { Decision } from '../../core/reader.ts';
import { childrenOf, sourceOf } from './typescript-syntax.ts';

type Walk = {
  readonly text: string;
  readonly nested: ReadonlySet<unknown>;
  readonly depth: number;
};

const lineOf = (node: Node): number => node.loc?.start.line ?? 0;

const firstStatementOf = (node: Node): Node | undefined =>
  node.type === 'BlockStatement' ? node.body[0] : node;

const thrownBy = (text: string, node: ThrowStatement): string =>
  node.argument.type === 'NewExpression'
    ? `throw new ${sourceOf(text, node.argument.callee)}`
    : `throw ${sourceOf(text, node.argument)}`;

const exitOf = (text: string, node: Node | undefined): string | undefined => {
  if (node?.type === 'ReturnStatement') return 'return';
  return node?.type === 'ThrowStatement' ? thrownBy(text, node) : undefined;
};

const ifAt = ({ text, depth }: Walk, node: IfStatement): Decision => {
  const condition = `if (${sourceOf(text, node.test)})`;
  const line = lineOf(node);
  const exit =
    node.alternate === null ? exitOf(text, firstStatementOf(node.consequent)) : undefined;
  return exit === undefined
    ? { kind: 'if', text: condition, depth, line }
    : { kind: 'guard', text: `${condition} ${exit}`, depth, line };
};

type Head = Pick<Decision, 'kind' | 'text'>;

const loopHead = (text: string, node: Node, body: Node): string =>
  text.slice(node.start ?? undefined, body.start ?? undefined).trim();

const headOf = (text: string, node: Node): Head | undefined => {
  switch (node.type) {
    case 'ForStatement':
    case 'ForInStatement':
    case 'ForOfStatement':
    case 'WhileStatement':
      return { kind: 'loop', text: loopHead(text, node, node.body) };
    case 'DoWhileStatement':
      return { kind: 'loop', text: `do … while (${sourceOf(text, node.test)})` };
    case 'ThrowStatement':
      return { kind: 'throw', text: thrownBy(text, node) };
    case 'CatchClause':
      return {
        kind: 'catch',
        text: node.param ? `catch (${sourceOf(text, node.param)})` : 'catch',
      };
    case 'SwitchCase':
      return { kind: 'case', text: node.test ? `case ${sourceOf(text, node.test)}:` : 'default:' };
    case 'ConditionalExpression':
      return { kind: 'ternary', text: `${sourceOf(text, node.test)} ?` };
    default:
      return undefined;
  }
};

const decisionAt = (walk: Walk, node: Node): Decision | undefined => {
  if (node.type === 'IfStatement') return ifAt(walk, node);
  const head = headOf(walk.text, node);
  return head && { ...head, depth: walk.depth, line: lineOf(node) };
};

const isElseIf = (node: Node, child: Node): boolean =>
  node.type === 'IfStatement' && node.alternate === child;

const decisionsUnder = (walk: Walk, node: Node): ReadonlyArray<Decision> =>
  childrenOf(node)
    .filter(child => !walk.nested.has(child))
    .flatMap(child => {
      const at = isElseIf(node, child) ? { ...walk, depth: walk.depth - 1 } : walk;
      const own = decisionAt(at, child);
      if (own?.kind === 'guard') return [own];
      const inner = decisionsUnder(own ? { ...at, depth: at.depth + 1 } : at, child);
      return own ? [own, ...inner] : inner;
    });

type DecisionsOptions = {
  readonly text: string;
  readonly node: Node;
  readonly nested: ReadonlySet<unknown>;
};

export const decisionsIn = ({ text, node, nested }: DecisionsOptions): ReadonlyArray<Decision> =>
  decisionsUnder({ text, nested, depth: 0 }, node);
