import type { MetricFinding } from './metric-findings.ts';

const DIMENSIONS = [
  'structure',
  'logic',
  'api',
  'tests',
  'metrics',
  'dependencies',
  'rules',
  'schema',
  'routes',
  'blast-radius',
  'security',
  'tenancy',
  'deploy',
  'performance',
  'failure',
  'ownership',
  'cohesion',
] as const;

export type Dimension = (typeof DIMENSIONS)[number];

export type Finding = {
  readonly id: string;
  readonly dimension: Dimension;
  readonly level: 'look' | 'info';
  readonly target?: string;
  readonly title: string;
  readonly detail?: string;
};

const METRIC_NAMES = { cyclomatic: 'cyclomatic', lines: 'lines', abc: 'ABC size' } as const;

const tenths = (value: number) => Math.round(value * 10) / 10;

const move = (base: number | undefined, head: number) =>
  base === undefined ? `${tenths(head)}` : `${tenths(base)} → ${tenths(head)}`;

const metricTitle = (finding: MetricFinding) => {
  if (finding.metric !== 'hotspot') {
    const { metric, base, head, threshold } = finding;
    return `${METRIC_NAMES[metric]} ${move(base, head)}, over ${threshold}`;
  }
  const { base, head, threshold } = finding;
  return `hotspot, churn ${move(base?.churn, head.churn)} and cyclomatic ${move(base?.cyclomatic, head.cyclomatic)}, over ${threshold.churn} and ${threshold.cyclomatic}`;
};

export const metricsFindings = (
  metricFindings: ReadonlyArray<MetricFinding>,
): ReadonlyArray<Finding> =>
  metricFindings.map(finding => ({
    id: `metrics:${finding.metric}:${finding.node}`,
    dimension: 'metrics',
    level: finding.level,
    target: finding.node,
    title: metricTitle(finding),
  }));
