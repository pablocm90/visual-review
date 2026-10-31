import type { DiffedNode } from './diff-graphs.ts';
import { stackOfIn } from './graph.ts';
import type { NodeMetrics } from './metrics.ts';
import type { PageData } from './page.ts';

export type MeasuredLeaf = { readonly node: DiffedNode; readonly stack: string } & Omit<
  NodeMetrics,
  'highestInside'
>;

export const measuredLeaves = ({
  diff,
  metrics,
}: Pick<PageData, 'diff' | 'metrics'>): ReadonlyArray<MeasuredLeaf> => {
  const stackOf = stackOfIn(diff.nodes);
  return diff.nodes.flatMap(node => {
    const measures = metrics[node.id];
    return measures === undefined || measures.highestInside
      ? []
      : [{ node, stack: stackOf(node.id), ...measures }];
  });
};
