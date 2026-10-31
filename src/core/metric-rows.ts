import type { DiffedNode } from './diff-graphs.ts';
import { stackOfIn } from './graph.ts';
import type { NodeMeasures, NodeMetrics } from './metrics.ts';
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

type Complex = Extract<NodeMeasures, { readonly lines: number }>;

const delta =
  (measure: (side: Complex) => number) =>
  ({ base, head }: MeasuredLeaf): number => {
    const of = (side: NodeMeasures | undefined) => (side && 'lines' in side ? measure(side) : 0);
    return of(head) - of(base);
  };

const sortValues = {
  cyclomatic: delta(side => side.cyclomatic.highest),
  churn: ({ head }: MeasuredLeaf) => head?.churn ?? 0,
  lines: delta(side => side.lines),
  abc: delta(side => side.abc),
};

export type SortKey = keyof typeof sortValues;

export const sortedLeaves = ({
  leaves,
  by,
}: {
  readonly leaves: ReadonlyArray<MeasuredLeaf>;
  readonly by: SortKey;
}): ReadonlyArray<MeasuredLeaf> => {
  const value = sortValues[by];
  return leaves.toSorted((a, b) => value(b) - value(a));
};
