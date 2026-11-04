import type { FilePatch, GraphDiff } from './diff-graphs.ts';
import { endsOfId, type GraphNode } from './graph.ts';
import type { DanglingCall } from './linker.ts';
import type { MetricFinding } from './metric-findings.ts';
import { type NodeMetrics, tenths } from './metrics.ts';
import type { ReviewNotes } from './notes.ts';
import type { PageData } from './page.ts';
import type { SymbolFile } from './read-range.ts';
import { notReadLine, type Skipped } from './skipped.ts';
import type { SplitSuggestion } from './split-suggestion.ts';
import { symbolFindings } from './symbol-findings.ts';
import { anyChanged, type TestFile } from './test-changes.ts';
import { testsAlongside } from './tests-alongside.ts';
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
  readonly groups?: SplitSuggestion['groups'];
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

export const counted = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

type RaisedOptions = {
  readonly skipped: ReadonlyArray<Skipped>;
  readonly undrawn: ReadonlyArray<FilePatch>;
  readonly dangling: ReadonlyArray<DanglingCall>;
  readonly metricFindings: ReadonlyArray<MetricFinding>;
  readonly symbols: ReadonlyArray<SymbolFile>;
  readonly symbolsNotRead: ReadonlyArray<string>;
  readonly nodes: ReadonlyArray<GraphNode>;
  readonly tests: ReadonlyArray<TestFile>;
  readonly split: SplitSuggestion | undefined;
};

type UntestedOptions = Pick<RaisedOptions, 'nodes' | 'tests'>;

const withUntestedLogic = (
  findings: ReadonlyArray<Finding>,
  { nodes, tests }: UntestedOptions,
): ReadonlyArray<Finding> => [
  ...findings,
  ...nodes
    .filter(node =>
      findings.some(({ dimension, target }) => dimension === 'logic' && target === node.id),
    )
    .filter(
      node =>
        !testsAlongside({ nodes, node, tests }).some(
          test => 'unreadable' in test || anyChanged(test.statements),
        ),
    )
    .map(
      (node): Finding => ({
        id: `tests:untested-logic:${node.id}`,
        dimension: 'tests',
        level: 'look',
        target: node.id,
        title: 'logic changed with no test changed alongside',
      }),
    ),
];

const SPLIT_CAVEAT =
  'Read from the edges between parts, so parts tied through an unchanged file, an edge between the boxes holding them, a dynamic import or Ruby metaprogramming can look independent.';

const splitFinding = ({ groups, leftOut }: SplitSuggestion): Finding => ({
  id: 'cohesion:split',
  dimension: 'cohesion',
  level: 'info',
  title: `may be ${groups.length} independent changes`,
  detail:
    leftOut === 0
      ? SPLIT_CAVEAT
      : `${counted(leftOut, 'part', 'parts')} in smaller groups left out. ${SPLIT_CAVEAT}`,
  groups,
});

export const skippedFindingId = (skip: Skipped) => `structure:skipped:${skip.reader}`;

export const raisedFindings = ({
  skipped,
  undrawn,
  dangling,
  metricFindings,
  symbols,
  symbolsNotRead,
  nodes,
  tests,
  split,
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
  ...withUntestedLogic(symbolFindings({ files: symbols, nodes }), { nodes, tests }),
  ...symbolsNotRead.map(
    (stack): Finding => ({
      id: `structure:symbols-not-read:${stack}`,
      dimension: 'structure',
      level: 'info',
      target: stack,
      title: `symbols not read for ${stack}`,
    }),
  ),
  ...(split === undefined ? [] : [splitFinding(split)]),
];

const NOTE_FLAG = 'notes:';

export const targetOfNoteFlag = (id: string): string | undefined =>
  id.startsWith(NOTE_FLAG) ? id.slice(NOTE_FLAG.length) : undefined;

type FindingsOfOptions = {
  readonly data: Pick<PageData, 'findings'>;
  readonly notes: ReviewNotes | undefined;
};

export const findingsOf = ({ data, notes }: FindingsOfOptions): ReadonlyArray<Finding> => [
  ...data.findings,
  ...Object.entries(notes?.notes ?? {}).flatMap(([id, { flag, dimension = 'structure' }]) =>
    flag === undefined
      ? []
      : [{ id: `${NOTE_FLAG}${id}`, dimension, level: 'look' as const, target: id, title: flag }],
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
