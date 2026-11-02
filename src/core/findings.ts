import type { FilePatch } from './diff-graphs.ts';
import type { MetricFinding } from './metric-findings.ts';
import { tenths } from './metrics.ts';
import { notReadLine, type Skipped } from './skipped.ts';

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

const counted = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

type RaisedOptions = {
  readonly skipped: ReadonlyArray<Skipped>;
  readonly undrawn: ReadonlyArray<FilePatch>;
  readonly metricFindings: ReadonlyArray<MetricFinding>;
};

export const raisedFindings = ({
  skipped,
  undrawn,
  metricFindings,
}: RaisedOptions): ReadonlyArray<Finding> => [
  ...skipped.map(
    (skip): Finding => ({
      id: `structure:skipped:${skip.reader}`,
      dimension: 'structure',
      level: 'look',
      title: notReadLine(skip),
    }),
  ),
  ...(undrawn.length === 0
    ? []
    : [
        {
          id: 'structure:undrawn',
          dimension: 'structure' as const,
          level: 'info' as const,
          title: `${counted(undrawn.length, 'changed file', 'changed files')} outside the graph`,
          detail: undrawn.map(patch => patch.path).join(', '),
        },
      ]),
  ...metricFindings.map(
    (finding): Finding => ({
      id: `metrics:${finding.metric}:${finding.node}`,
      dimension: 'metrics',
      level: finding.level,
      target: finding.node,
      title: metricTitle(finding),
    }),
  ),
];
