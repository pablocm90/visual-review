import { deepestHolding } from './diff-graphs.ts';
import { endsOfId, type GraphNode } from './graph.ts';
import type { Comment } from './review.ts';
import type { TestFile } from './test-changes.ts';
import { nodeOfTests } from './tests-alongside.ts';

type Anchor = Comment['anchor'];

export const split = (id: string, at: string): readonly [string, string] => {
  const cut = id.indexOf(at);
  return [id.slice(0, cut), id.slice(cut + at.length)];
};

export const anchorKey = ({ kind, id }: { readonly kind: string; readonly id: string }): string =>
  `${kind} ${id}`;

export const fileOfLine = (id: string): string => id.slice(0, id.lastIndexOf('@'));

export type TargetsOf = {
  readonly nodes: ReadonlyArray<Pick<GraphNode, 'id' | 'label' | 'parent' | 'path'>>;
  readonly tests: ReadonlyArray<Pick<TestFile, 'path' | 'stack'>>;
};

export const isHeld = ({ nodes }: Pick<TargetsOf, 'nodes'>, id: string): boolean =>
  nodes.some(node => node.id === id);

const namedTarget = (anchor: Anchor, { nodes, tests }: TargetsOf): string | undefined => {
  if (anchor.kind === 'symbol' || anchor.kind === 'decision') return split(anchor.id, '#')[0];
  if (anchor.kind === 'line') return deepestHolding(fileOfLine(anchor.id), nodes)?.id;
  if (anchor.kind !== 'test') return anchor.id;
  const file = tests.find(({ path }) => path === split(anchor.id, '#')[0]);
  return file && nodeOfTests({ nodes, file });
};

export const anchorTarget = (anchor: Anchor, targets: TargetsOf): string | undefined => {
  const target = namedTarget(anchor, targets);
  return target !== undefined && endsOfId(target).every(end => isHeld(targets, end))
    ? target
    : undefined;
};
