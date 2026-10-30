import type { GraphDiff } from './diff-graphs.ts';
import type { Graph } from './graph.ts';
import type { Churn, RangeReading } from './read-range.ts';

export type NodeMeasures = {
  readonly churn: number;
};

export type NodeMetrics = {
  readonly highestInside?: true;
  readonly base?: NodeMeasures;
  readonly head?: NodeMeasures;
};

type NodeMetricsOptions = {
  readonly diff: GraphDiff;
  readonly before: Graph;
  readonly churn: RangeReading['churn'];
};

const measuresAt = (churn: Churn, path: string | undefined): NodeMeasures | undefined => {
  const commits = path === undefined ? undefined : churn[path];
  return commits === undefined ? undefined : { churn: commits };
};

const sides = (base: NodeMeasures | undefined, head: NodeMeasures | undefined): NodeMetrics => ({
  ...(base && { base }),
  ...(head && { head }),
});

const highest = (measures: ReadonlyArray<NodeMeasures | undefined>): NodeMeasures | undefined => {
  const churns = measures.flatMap(each => (each === undefined ? [] : [each.churn]));
  return churns.length === 0 ? undefined : { churn: Math.max(...churns) };
};

export const nodeMetrics = ({
  diff,
  before,
  churn,
}: NodeMetricsOptions): Readonly<Record<string, NodeMetrics>> => {
  const changed = new Set(
    diff.nodes.filter(node => node.state !== 'unchanged').map(node => node.id),
  );
  const measured = new Set([
    ...changed,
    ...diff.edges
      .filter(({ from, to }) => changed.has(from) || changed.has(to))
      .flatMap(({ from, to }) => [from, to]),
  ]);
  const basePath = new Map(before.nodes.map(({ id, path }) => [id, path]));
  const leaves: Readonly<Record<string, NodeMetrics>> = Object.fromEntries(
    diff.nodes
      .filter(node => measured.has(node.id))
      .flatMap(node => {
        const base = measuresAt(churn.before, node.renamedFrom ?? basePath.get(node.id));
        const head = measuresAt(churn.after, node.path);
        if (base === undefined && head === undefined) return [];
        return [[node.id, sides(base, head)]];
      }),
  );
  const parentOf = new Map(diff.nodes.map(({ id, parent }) => [id, parent]));
  const isInside = (id: string, box: string): boolean => {
    const parent = parentOf.get(id);
    return parent !== undefined && (parent === box || isInside(parent, box));
  };
  const boxes = diff.nodes.flatMap(node => {
    const inside = Object.entries(leaves)
      .filter(([id]) => isInside(id, node.id))
      .map(([, metrics]) => metrics);
    if (inside.length === 0) return [];
    const base = highest(inside.map(metrics => metrics.base));
    const head = highest(inside.map(metrics => metrics.head));
    return [[node.id, { highestInside: true, ...sides(base, head) }]];
  });
  return { ...leaves, ...Object.fromEntries(boxes) };
};
