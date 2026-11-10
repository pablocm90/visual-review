import { accessFindings } from './access-findings.ts';
import { anchorOfKey, anchorTarget, isNoted, type Noted } from './anchors.ts';
import type { Check } from './checks.ts';
import { dependencyFindings } from './dependency-findings.ts';
import type { FilePatch, GraphDiff } from './diff-graphs.ts';
import { endsOfId, type GraphNode } from './graph.ts';
import type { DanglingCall } from './linker.ts';
import type { MetricFinding } from './metric-findings.ts';
import { tenths } from './metrics.ts';
import { migrationFindings } from './migration-findings.ts';
import type { ReviewNotes } from './notes.ts';
import type { PageData } from './page.ts';
import { reachFindings } from './reach-findings.ts';
import type { AccessReading } from './read-access.ts';
import type { DependencyChanges } from './read-lockfiles.ts';
import type { MigrationReading } from './read-migrations.ts';
import type { SymbolFile } from './read-range.ts';
import type { Reach } from './read-reaches.ts';
import type { RoutesReading } from './read-routes.ts';
import type { SchemaReading } from './read-schemas.ts';
import { routeFindings } from './route-findings.ts';
import type { RuleBreak } from './rule-breaks.ts';
import { ruleFindings } from './rule-findings.ts';
import { schemaFindings } from './schema-findings.ts';
import { notReadLine, type Skipped } from './skipped.ts';
import type { SplitSuggestion } from './split-suggestion.ts';
import { partsWithLogicToTest, symbolFindings } from './symbol-findings.ts';
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
  readonly check: Check | 'flag';
  readonly dimension: Dimension;
  readonly level: 'look' | 'info';
  readonly target?: string;
  readonly file?: string;
  readonly table?: string;
  readonly route?: string;
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
  readonly changedPaths: ReadonlyArray<string>;
  readonly undrawn: ReadonlyArray<FilePatch>;
  readonly dangling: ReadonlyArray<DanglingCall>;
  readonly dependencyChanges: ReadonlyArray<DependencyChanges>;
  readonly migrations: ReadonlyArray<MigrationReading>;
  readonly schemas: ReadonlyArray<SchemaReading>;
  readonly routes: ReadonlyArray<RoutesReading>;
  readonly access: ReadonlyArray<AccessReading>;
  readonly metricFindings: ReadonlyArray<MetricFinding>;
  readonly symbols: ReadonlyArray<SymbolFile>;
  readonly symbolsNotRead: ReadonlyArray<string>;
  readonly reaches: ReadonlyArray<Reach>;
  readonly nodes: ReadonlyArray<GraphNode>;
  readonly tests: ReadonlyArray<TestFile>;
  readonly split: SplitSuggestion | undefined;
  readonly ruleBreaks: ReadonlyArray<RuleBreak>;
  readonly edges: GraphDiff['edges'];
};

type UntestedOptions = Pick<RaisedOptions, 'nodes' | 'tests' | 'symbols'>;

const untestedLogicFindings = ({
  nodes,
  tests,
  symbols,
}: UntestedOptions): ReadonlyArray<Finding> => {
  const toTest = partsWithLogicToTest(symbols);
  return nodes
    .filter(node => toTest.has(node.id))
    .filter(
      node =>
        !testsAlongside({ nodes, node, tests }).some(
          test => 'unreadable' in test || anyChanged(test.statements),
        ),
    )
    .map(
      (node): Finding => ({
        id: `tests:untested-logic:${node.id}`,
        check: 'tests:untested-logic',
        dimension: 'tests',
        level: 'look',
        target: node.id,
        title: 'logic changed with no test changed alongside',
      }),
    );
};

const SPLIT_CAVEAT =
  'Read from the edges between parts, so parts tied through an unchanged file, an edge between the boxes holding them, a dynamic import or Ruby metaprogramming can look independent.';

const splitFinding = ({ groups, leftOut }: SplitSuggestion): Finding => ({
  id: 'cohesion:split',
  check: 'cohesion:split',
  dimension: 'cohesion',
  level: 'info',
  title: `may be ${groups.length} independent changes`,
  detail:
    leftOut === 0
      ? SPLIT_CAVEAT
      : `${counted(leftOut, 'part', 'parts')} in smaller groups left out. ${SPLIT_CAVEAT}`,
  groups,
});

const namesNotUtf8Finding = (paths: ReadonlyArray<string>): ReadonlyArray<Finding> =>
  paths.length === 0
    ? []
    : [
        {
          id: 'structure:name-not-utf8',
          check: 'structure:name-not-utf8',
          dimension: 'structure',
          level: 'look',
          title:
            paths.length === 1
              ? "1 changed file's name isn't UTF-8, so its patch can't be shown"
              : `${paths.length} changed files' names aren't UTF-8, so their patches can't be shown`,
          detail: paths.join(', '),
        },
      ];

export const skippedFindingId = ({ stacks, side }: Skipped) =>
  `structure:skipped:${stacks.join(',')}${side === undefined ? '' : `:${side}`}`;

export const raisedFindings = ({
  skipped,
  changedPaths,
  undrawn,
  dangling,
  dependencyChanges,
  migrations,
  schemas,
  routes,
  access,
  metricFindings,
  symbols,
  symbolsNotRead,
  reaches,
  nodes,
  tests,
  split,
  ruleBreaks,
  edges,
}: RaisedOptions): ReadonlyArray<Finding> => [
  ...skipped.map(
    (skip): Finding => ({
      id: skippedFindingId(skip),
      check: 'structure:skipped',
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
          check: 'structure:undrawn' as const,
          dimension: 'structure' as const,
          level: 'info' as const,
          title: `${counted(undrawn.length, 'changed file', 'changed files')} outside the graph`,
          detail: undrawn.map(patch => patch.path).join(', '),
        },
      ]),
  ...namesNotUtf8Finding(changedPaths.filter(path => path.includes('\uFFFD'))),
  ...[...Map.groupBy(dangling, call => call.from)].map(
    ([from, calls]): Finding => ({
      id: `routes:dangling:${from}`,
      check: 'routes:dangling',
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
      check: `metrics:${finding.metric}`,
      dimension: 'metrics',
      level: finding.level,
      target: finding.node,
      title: metricTitle(finding),
    }),
  ),
  ...symbolFindings({ files: symbols, nodes }),
  ...reachFindings(reaches),
  ...untestedLogicFindings({ nodes, tests, symbols }),
  ...symbolsNotRead.map(
    (stack): Finding => ({
      id: `structure:symbols-not-read:${stack}`,
      check: 'structure:symbols-not-read',
      dimension: 'structure',
      level: 'info',
      target: stack,
      title: `symbols not read for ${stack}`,
    }),
  ),
  ...(split === undefined ? [] : [splitFinding(split)]),
  ...ruleFindings({ ruleBreaks, edges }),
  ...dependencyFindings(dependencyChanges),
  ...migrationFindings(migrations),
  ...schemaFindings(schemas),
  ...routeFindings(routes),
  ...accessFindings({ access, routes: [], nodes, open: [] }),
];

const NOTE_FLAG = 'notes:';

export const anchorOfNoteFlag = (id: string): Noted | undefined => {
  if (!id.startsWith(NOTE_FLAG)) return undefined;
  const anchor = anchorOfKey(id.slice(NOTE_FLAG.length));
  return isNoted(anchor) ? anchor : undefined;
};

type FindingsOfOptions = {
  readonly data: Pick<PageData, 'findings' | 'tests'> & {
    readonly diff: Pick<PageData['diff'], 'nodes'>;
  };
  readonly notes: ReviewNotes | undefined;
};

export const findingsOf = ({ data, notes }: FindingsOfOptions): ReadonlyArray<Finding> => [
  ...data.findings,
  ...Object.entries(notes?.notes ?? {}).flatMap(([key, { flag, dimension = 'structure' }]) => {
    if (flag === undefined) return [];
    const target = anchorTarget(anchorOfKey(key), { nodes: data.diff.nodes, tests: data.tests });
    return [
      {
        id: `${NOTE_FLAG}${key}`,
        check: 'flag' as const,
        dimension,
        level: 'look' as const,
        ...(target === undefined ? {} : { target }),
        title: flag,
      },
    ];
  }),
];

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
