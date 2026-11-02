import type { FilePatch, GraphDiff } from './diff-graphs.ts';
import { endsOfId } from './graph.ts';
import type { DanglingCall } from './linker.ts';
import type { MetricFinding } from './metric-findings.ts';
import { type NodeMetrics, tenths } from './metrics.ts';
import type { ReviewNotes } from './notes.ts';
import type { PageData } from './page.ts';
import type { SymbolFile } from './read-range.ts';
import { notReadLine, type Skipped } from './skipped.ts';
import { symbolFindings } from './symbol-findings.ts';
import { visibleNodeOf } from './visible-diff.ts';

export const DIMENSIONS = [
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
  readonly dangling: ReadonlyArray<DanglingCall>;
  readonly metricFindings: ReadonlyArray<MetricFinding>;
  readonly symbols: ReadonlyArray<SymbolFile>;
};

export const skippedFindingId = (skip: Skipped) => `structure:skipped:${skip.reader}`;

export const raisedFindings = ({
  skipped,
  undrawn,
  dangling,
  metricFindings,
  symbols,
}: RaisedOptions): ReadonlyArray<Finding> => [
  ...skipped.map(
    (skip): Finding => ({
      id: skippedFindingId(skip),
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
  ...[...Map.groupBy(dangling, call => call.from)].map(
    ([from, calls]): Finding => ({
      id: `routes:dangling:${from}`,
      dimension: 'routes',
      level: 'info',
      target: from,
      title: counted(calls.length, 'call with no route', 'calls with no route'),
      detail: calls.map(call => call.path).join(', '),
    }),
  ),
  ...metricFindings.map(
    (finding): Finding => ({
      id: `metrics:${finding.metric}:${finding.node}`,
      dimension: 'metrics',
      level: finding.level,
      target: finding.node,
      title: metricTitle(finding),
    }),
  ),
  ...symbolFindings(symbols),
];

type FindingsOfOptions = {
  readonly data: Pick<PageData, 'findings'>;
  readonly notes: ReviewNotes | undefined;
};

export const findingsOf = ({ data, notes }: FindingsOfOptions): ReadonlyArray<Finding> => [
  ...data.findings,
  ...Object.entries(notes?.notes ?? {}).flatMap(([id, { flag, dimension = 'structure' }]) =>
    flag === undefined
      ? []
      : [{ id: `notes:${id}`, dimension, level: 'look' as const, target: id, title: flag }],
  ),
];

type LookFirstOptions = {
  readonly findings: ReadonlyArray<Finding>;
  readonly metrics: Readonly<Record<string, NodeMetrics>>;
};

export const lookFirst = ({ findings, metrics }: LookFirstOptions): ReadonlyArray<Finding> => {
  const highest = (target: string | undefined, measure: 'fanIn' | 'churn') =>
    target === undefined
      ? Number.POSITIVE_INFINITY
      : Math.max(...endsOfId(target).map(end => metrics[end]?.head?.[measure] ?? 0));
  const before = (one: Finding, other: Finding) =>
    highest(other.target, 'fanIn') - highest(one.target, 'fanIn') ||
    highest(other.target, 'churn') - highest(one.target, 'churn') ||
    (one.id < other.id ? -1 : 1);
  return findings.filter(finding => finding.level === 'look').toSorted(before);
};

type FindingsAtOptions = {
  readonly diff: GraphDiff;
  readonly expanded: ReadonlySet<string>;
  readonly findings: ReadonlyArray<Finding>;
};

export const findingsAt = ({
  diff,
  expanded,
  findings,
}: FindingsAtOptions): ReadonlyMap<string, ReadonlyArray<Finding>> => {
  const visibleOf = visibleNodeOf({ diff, expanded });
  const drawnOf = (target: string) => endsOfId(target).map(visibleOf).join(' -> ');
  return Map.groupBy(
    findings.filter(
      (finding): finding is Finding & { target: string } => finding.target !== undefined,
    ),
    finding => drawnOf(finding.target),
  );
};
