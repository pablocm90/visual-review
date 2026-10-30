import type { GraphDiff } from './diff-graphs.ts';
import type { Churn, RangeReading } from './read-range.ts';

export type NodeMeasures = {
  readonly churn: number;
};

export type NodeMetrics = {
  readonly base?: NodeMeasures;
  readonly head?: NodeMeasures;
};

type NodeMetricsOptions = {
  readonly diff: GraphDiff;
  readonly churn: RangeReading['churn'];
};

const measuresAt = (churn: Churn, path: string): NodeMeasures | undefined => {
  const commits = churn[path];
  return commits === undefined ? undefined : { churn: commits };
};

export const nodeMetrics = ({
  diff,
  churn,
}: NodeMetricsOptions): Readonly<Record<string, NodeMetrics>> =>
  Object.fromEntries(
    diff.nodes
      .filter(node => node.state !== 'unchanged')
      .flatMap(node => {
        const base = measuresAt(churn.before, node.path);
        const head = measuresAt(churn.after, node.path);
        if (base === undefined && head === undefined) return [];
        return [[node.id, { ...(base && { base }), ...(head && { head }) }]];
      }),
  );
