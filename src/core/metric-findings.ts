import type { NodeMeasures, NodeMetrics } from './metrics.ts';
import type { RangeReading } from './read-range.ts';

type Hotspot = RangeReading['thresholds']['hotspot'];

type Finding<Metric, Value> = {
  readonly node: string;
  readonly metric: Metric;
  readonly level: 'look' | 'info';
  readonly base?: Value;
  readonly head: Value;
  readonly threshold: Value;
};

export type MetricFinding = Finding<'cyclomatic', number> | Finding<'hotspot', Hotspot>;

type MetricFindingsOptions = {
  readonly metrics: Readonly<Record<string, NodeMetrics>>;
  readonly thresholds: RangeReading['thresholds'];
};

type FindingOptions<Metric, Value> = Omit<Finding<Metric, Value>, 'level' | 'base'> & {
  readonly base: Value | undefined;
  readonly look: boolean;
};

const finding = <Metric, Value>({
  base,
  look,
  ...rest
}: FindingOptions<Metric, Value>): Finding<Metric, Value> => ({
  ...rest,
  level: look ? 'look' : 'info',
  ...(base === undefined ? {} : { base }),
});

const cyclomaticOf = (measures: NodeMeasures | undefined): number | undefined =>
  measures !== undefined && 'lines' in measures ? measures.cyclomatic.highest : undefined;

const hotspotOf = (measures: NodeMeasures | undefined): Hotspot | undefined => {
  const cyclomatic = cyclomaticOf(measures);
  return measures === undefined || cyclomatic === undefined
    ? undefined
    : { churn: measures.churn, cyclomatic };
};

const cyclomaticFindings = (
  node: string,
  { base, head }: NodeMetrics,
  threshold: number,
): ReadonlyArray<MetricFinding> => {
  const headValue = cyclomaticOf(head);
  if (headValue === undefined || headValue <= threshold) return [];
  const baseValue = cyclomaticOf(base);
  const look = baseValue === undefined || headValue > baseValue;
  return [
    finding({ node, metric: 'cyclomatic', base: baseValue, head: headValue, threshold, look }),
  ];
};

const hotspotFindings = (
  node: string,
  { base, head }: NodeMetrics,
  threshold: Hotspot,
): ReadonlyArray<MetricFinding> => {
  const headValue = hotspotOf(head);
  if (
    headValue === undefined ||
    headValue.churn < threshold.churn ||
    headValue.cyclomatic < threshold.cyclomatic
  )
    return [];
  const baseValue = hotspotOf(base);
  const look =
    baseValue === undefined ||
    baseValue.churn < threshold.churn ||
    headValue.cyclomatic > baseValue.cyclomatic;
  return [finding({ node, metric: 'hotspot', base: baseValue, head: headValue, threshold, look })];
};

export const metricFindings = ({
  metrics,
  thresholds,
}: MetricFindingsOptions): ReadonlyArray<MetricFinding> =>
  Object.entries(metrics).flatMap(([node, nodeMetrics]) =>
    nodeMetrics.highestInside
      ? []
      : [
          ...cyclomaticFindings(node, nodeMetrics, thresholds.cyclomatic),
          ...hotspotFindings(node, nodeMetrics, thresholds.hotspot),
        ],
  );
