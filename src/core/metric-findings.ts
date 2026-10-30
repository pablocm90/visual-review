import type { NodeMeasures, NodeMetrics } from './metrics.ts';
import type { RangeReading } from './read-range.ts';

export type MetricFinding = {
  readonly node: string;
  readonly metric: 'cyclomatic';
  readonly level: 'look' | 'info';
  readonly base?: number;
  readonly head: number;
  readonly threshold: number;
};

type MetricFindingsOptions = {
  readonly metrics: Readonly<Record<string, NodeMetrics>>;
  readonly thresholds: RangeReading['thresholds'];
};

const cyclomaticOf = (measures: NodeMeasures | undefined): number | undefined =>
  measures !== undefined && 'lines' in measures ? measures.cyclomatic.highest : undefined;

export const metricFindings = ({
  metrics,
  thresholds,
}: MetricFindingsOptions): ReadonlyArray<MetricFinding> =>
  Object.entries(metrics).flatMap(([node, { highestInside, base, head }]) => {
    const threshold = thresholds.cyclomatic;
    const headValue = cyclomaticOf(head);
    if (highestInside || headValue === undefined || headValue <= threshold) return [];
    const baseValue = cyclomaticOf(base);
    const grew = baseValue === undefined || headValue > baseValue;
    return [
      {
        node,
        metric: 'cyclomatic',
        level: grew ? 'look' : 'info',
        ...(baseValue === undefined ? {} : { base: baseValue }),
        head: headValue,
        threshold,
      },
    ];
  });
