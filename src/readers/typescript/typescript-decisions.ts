import type { Node } from '@babel/types';
import type { Decision } from '../../core/reader.ts';
import { childrenOf, sourceOf } from './typescript-syntax.ts';

type Walk = {
  readonly text: string;
  readonly depth: number;
};

const decisionAt = ({ text, depth }: Walk, node: Node): Decision | undefined =>
  node.type === 'IfStatement'
    ? {
        kind: 'if',
        text: `if (${sourceOf(text, node.test)})`,
        depth,
        line: node.loc?.start.line ?? 0,
      }
    : undefined;

const decisionsUnder = (walk: Walk, node: Node): ReadonlyArray<Decision> =>
  childrenOf(node).flatMap(child => {
    const own = decisionAt(walk, child);
    const inner = decisionsUnder(own ? { ...walk, depth: walk.depth + 1 } : walk, child);
    return own ? [own, ...inner] : inner;
  });

type DecisionsOptions = {
  readonly text: string;
  readonly node: Node;
};

export const decisionsIn = ({ text, node }: DecisionsOptions): ReadonlyArray<Decision> =>
  decisionsUnder({ text, depth: 0 }, node);
