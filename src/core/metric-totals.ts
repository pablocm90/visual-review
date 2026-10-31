import type { DiffedNode, GraphDiff } from './diff-graphs.ts';
import type { FunctionCyclomatic, NodeMeasures, NodeMetrics } from './metrics.ts';
import type { RangeReading } from './read-range.ts';

type MetricTotalsOptions = {
  readonly diff: GraphDiff;
  readonly metrics: Readonly<Record<string, NodeMetrics>>;
  readonly thresholds: RangeReading['thresholds'];
};

export type MetricTotals = {
  readonly lines: { readonly by: number; readonly across: number };
  readonly over: {
    readonly base: number;
    readonly head: number;
    readonly highest?: FunctionCyclomatic;
  };
};

type Leaf = { readonly node: DiffedNode } & NodeMetrics;

const linesOf = (side: NodeMeasures | undefined): number | undefined =>
  side && 'lines' in side ? side.lines : undefined;

const functionsOf = (side: NodeMeasures | undefined): ReadonlyArray<FunctionCyclomatic> =>
  (side && 'lines' in side && side.cyclomatic.byFunction) || [];

export const metricTotals = ({ diff, metrics, thresholds }: MetricTotalsOptions): MetricTotals => {
  const changed: ReadonlyArray<Leaf> = diff.nodes.flatMap(node => {
    const measures = metrics[node.id];
    return measures === undefined || measures.highestInside || node.state === 'unchanged'
      ? []
      : [{ node, ...measures }];
  });
  const withLines = changed.filter(
    ({ base, head }) => linesOf(base) !== undefined || linesOf(head) !== undefined,
  );
  const functions = (side: 'base' | 'head') => changed.flatMap(leaf => functionsOf(leaf[side]));
  const overOn = (side: 'base' | 'head') =>
    functions(side).filter(({ cyclomatic }) => cyclomatic > thresholds.cyclomatic).length;
  const highest = functions('head').reduce<FunctionCyclomatic | undefined>(
    (most, each) => (most === undefined || each.cyclomatic > most.cyclomatic ? each : most),
    undefined,
  );
  return {
    over: { base: overOn('base'), head: overOn('head'), ...(highest && { highest }) },
    lines: {
      by: withLines.reduce(
        (sum, { base, head }) => sum + (linesOf(head) ?? 0) - (linesOf(base) ?? 0),
        0,
      ),
      across: withLines.length,
    },
  };
};
