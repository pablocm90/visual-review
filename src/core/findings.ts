import { accessFindings } from './access-findings.ts';
import { anchorOfKey, anchorTarget, fileOfLine, isNoted, type Noted } from './anchors.ts';
import { counted } from './counted.ts';
import { dependencyFindings } from './dependency-findings.ts';
import { deployColumnFindings } from './deploy-columns.ts';
import { deployFlagFindings, deployKeyFindings, FLIPPER_FLAGS } from './deploy-findings.ts';
import type { FilePatch, GraphDiff } from './diff-graphs.ts';
import type { Finding } from './finding.ts';
import { endsOfId, type GraphNode } from './graph.ts';
import type { MetricFinding } from './metric-findings.ts';
import { tenths } from './metrics.ts';
import { migrationFindings } from './migration-findings.ts';
import type { ReviewNotes } from './notes.ts';
import type { PageData } from './page.ts';
import { reachFindings } from './reach-findings.ts';
import type { RangeReading } from './reading.ts';
import { routeFindings } from './route-findings.ts';
import { ruleFindings } from './rule-findings.ts';
import { schemaFindings } from './schema-findings.ts';
import { secretFindings } from './secret-findings.ts';
import { riskFindings, viewRiskFindings } from './security-findings.ts';
import { notReadLine, type Skipped } from './skipped.ts';
import type { SplitSuggestion } from './split-suggestion.ts';
import { partsWithLogicToTest, symbolFindings } from './symbol-findings.ts';
import { anyChanged } from './test-changes.ts';
import { testsAlongside } from './tests-alongside.ts';
import { visibleNodeOf } from './visible-diff.ts';

export { counted } from './counted.ts';
export { DIMENSIONS, type Dimension, type Finding, type PlaceInFile } from './finding.ts';

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

/** What the checks read: the reading's facts, plus what the page draws of them. */
type RaisedOptions = Pick<
  RangeReading,
  | 'skipped'
  | 'changedPaths'
  | 'patches'
  | 'danglingCalls'
  | 'dependencyChanges'
  | 'migrations'
  | 'schemas'
  | 'routes'
  | 'access'
  | 'openActions'
  | 'symbols'
  | 'symbolsNotRead'
  | 'reaches'
  | 'tests'
  | 'ruleBreaks'
  | 'deployKeysAtBase'
  | 'deployConfig'
> & {
  readonly undrawn: ReadonlyArray<FilePatch>;
  readonly metricFindings: ReadonlyArray<MetricFinding>;
  /** The drawn nodes, a diffed one with its state: a hotspot is raised on a changed node only. */
  readonly nodes: ReadonlyArray<GraphNode & { readonly state?: string }>;
  readonly edges: GraphDiff['edges'];
  readonly split: SplitSuggestion | undefined;
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

type Raise = (raised: RaisedOptions) => ReadonlyArray<Finding>;

/** Every check, in the order its findings are listed: each reads what it needs of the options. */
const RAISERS: ReadonlyArray<Raise> = [
  ({ skipped }) =>
    skipped.map(
      (skip): Finding => ({
        id: skippedFindingId(skip),
        check: 'structure:skipped',
        dimension: 'structure',
        level: 'look',
        title: notReadLine(skip),
      }),
    ),
  ({ undrawn }) =>
    undrawn.length === 0
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
        ],
  ({ changedPaths }) => namesNotUtf8Finding(changedPaths.filter(path => path.includes('\uFFFD'))),
  ({ danglingCalls }) =>
    [...Map.groupBy(danglingCalls, call => call.from)].map(
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
  ({ metricFindings, nodes }) =>
    metricFindings
      .filter(
        ({ metric, node }) =>
          metric !== 'hotspot' || nodes.find(({ id }) => id === node)?.state !== 'unchanged',
      )
      .map(
        (finding): Finding => ({
          id: `metrics:${finding.metric}:${finding.node}`,
          check: `metrics:${finding.metric}`,
          dimension: 'metrics',
          level: finding.level,
          target: finding.node,
          title: metricTitle(finding),
        }),
      ),
  ({ symbols, nodes }) => symbolFindings({ files: symbols, nodes }),
  ({ symbols }) => riskFindings(symbols),
  ({ patches }) => viewRiskFindings(patches),
  ({ patches }) => secretFindings(patches),
  ({ patches, deployKeysAtBase }) => deployKeyFindings({ patches, keysAtBase: deployKeysAtBase }),
  ({ patches, deployConfig }) =>
    deployFlagFindings({ patches, flags: deployConfig.flags ?? FLIPPER_FLAGS }),
  ({ schemas, patches }) => deployColumnFindings({ schemas, patches }),
  ({ reaches }) => reachFindings(reaches),
  ({ symbols, nodes, tests }) => untestedLogicFindings({ nodes, tests, symbols }),
  ({ symbolsNotRead }) =>
    symbolsNotRead.map(
      (stack): Finding => ({
        id: `structure:symbols-not-read:${stack}`,
        check: 'structure:symbols-not-read',
        dimension: 'structure',
        level: 'info',
        target: stack,
        title: `symbols not read for ${stack}`,
      }),
    ),
  ({ split }) => (split === undefined ? [] : [splitFinding(split)]),
  ({ ruleBreaks, edges }) => ruleFindings({ ruleBreaks, edges }),
  ({ dependencyChanges }) => dependencyFindings(dependencyChanges),
  ({ migrations }) => migrationFindings(migrations),
  ({ schemas }) => schemaFindings(schemas),
  ({ routes }) => routeFindings(routes),
  ({ routes, access, openActions, nodes }) =>
    accessFindings({
      access,
      routes: routes.flatMap(reading => ('routes' in reading ? reading.routes : [])),
      nodes,
      open: openActions,
    }),
];

export const raisedFindings = (raised: RaisedOptions): ReadonlyArray<Finding> =>
  RAISERS.flatMap(raise => raise(raised));

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
    const anchor = anchorOfKey(key);
    const target = anchorTarget(anchor, { nodes: data.diff.nodes, tests: data.tests });
    return [
      {
        id: `${NOTE_FLAG}${key}`,
        check: 'flag' as const,
        dimension,
        level: 'look' as const,
        ...(target !== undefined
          ? { target }
          : anchor.kind === 'line' && { file: fileOfLine(anchor.id), line: anchor.id }),
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
