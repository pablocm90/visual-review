import type { DiffedNode, GraphDiff } from './diff-graphs.ts';
import type { NodeMeasures, NodeMetrics } from './metrics.ts';
import type { RangeReading } from './read-range.ts';

type MetricTotalsOptions = {
  readonly diff: GraphDiff;
  readonly metrics: Readonly<Record<string, NodeMetrics>>;
  readonly thresholds: RangeReading['thresholds'];
};

export type MetricTotals = {
  readonly lines: { readonly by: number; readonly across: number };
};

type Leaf = { readonly node: DiffedNode } & NodeMetrics;

const linesOf = (side: NodeMeasures | undefined): number | undefined =>
  side && 'lines' in side ? side.lines : undefined;

export const metricTotals = ({ diff, metrics }: MetricTotalsOptions): MetricTotals => {
  const changed: ReadonlyArray<Leaf> = diff.nodes.flatMap(node => {
    const measures = metrics[node.id];
    return measures === undefined || measures.highestInside || node.state === 'unchanged'
      ? []
      : [{ node, ...measures }];
  });
  const withLines = changed.filter(
    ({ base, head }) => linesOf(base) !== undefined || linesOf(head) !== undefined,
  );
  return {
    lines: {
      by: withLines.reduce(
        (sum, { base, head }) => sum + (linesOf(head) ?? 0) - (linesOf(base) ?? 0),
        0,
      ),
      across: withLines.length,
    },
  };
};
