import type { Node } from '@babel/types';
import type { Decision } from '../../core/reader.ts';
import { childrenOf, sourceOf } from './typescript-syntax.ts';

type Walk = {
  readonly text: string;
  readonly nested: ReadonlySet<unknown>;
  readonly depth: number;
};

const firstStatementOf = (node: Node): Node | undefined =>
  node.type === 'BlockStatement' ? node.body[0] : node;

const isGuard = (node: Node): boolean =>
  node.type === 'IfStatement' &&
  node.alternate === null &&
  firstStatementOf(node.consequent)?.type === 'ReturnStatement';

const decisionAt = ({ text, depth }: Walk, node: Node): Decision | undefined => {
  if (node.type !== 'IfStatement') return undefined;
  const condition = `if (${sourceOf(text, node.test)})`;
  const line = node.loc?.start.line ?? 0;
  return isGuard(node)
    ? { kind: 'guard', text: `${condition} return`, depth, line }
    : { kind: 'if', text: condition, depth, line };
};

const isElseIf = (node: Node, child: Node): boolean =>
  node.type === 'IfStatement' && node.alternate === child;

const decisionsUnder = (walk: Walk, node: Node): ReadonlyArray<Decision> =>
  childrenOf(node)
    .filter(child => !walk.nested.has(child))
    .flatMap(child => {
      const at = isElseIf(node, child) ? { ...walk, depth: walk.depth - 1 } : walk;
      const own = decisionAt(at, child);
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
