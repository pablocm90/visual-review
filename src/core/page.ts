import { diffGraphs, type FilePatch, type GraphDiff, isAtOrUnder } from './diff-graphs.ts';
import { type Finding, raisedFindings } from './findings.ts';
import type { DanglingCall } from './linker.ts';
import { metricFindings } from './metric-findings.ts';
import { type NodeMetrics, nodeMetrics } from './metrics.ts';
import { notesProblems, type ReviewNotes } from './notes.ts';
import type { DependencyChanges } from './read-lockfiles.ts';
import type { RangeReading, SymbolFile } from './read-range.ts';
import { type ReadingOrder, readingOrder } from './reading-order.ts';
import type { Review } from './review.ts';
import { type SinceReview, sinceReviewOf } from './since-review.ts';
import type { Skipped } from './skipped.ts';
import { splitSuggestion } from './split-suggestion.ts';
import type { TestFile } from './test-changes.ts';

export type PullRequest = {
  readonly number: number;
  readonly title: string;
  readonly url: string;
};

export type PageData = {
  readonly repo: string;
  readonly range: string;
  readonly version: string;
  readonly parsers: Readonly<Record<string, string>>;
  readonly pullRequest?: PullRequest;
  readonly diff: GraphDiff;
  readonly readingOrder: ReadingOrder;
  readonly metrics: Readonly<Record<string, NodeMetrics>>;
  readonly findings: ReadonlyArray<Finding>;
  readonly dangling: ReadonlyArray<DanglingCall>;
  readonly patches: ReadonlyArray<FilePatch>;
  readonly undrawn: ReadonlyArray<FilePatch>;
  readonly dependencyChanges: ReadonlyArray<DependencyChanges>;
  readonly tests: ReadonlyArray<TestFile>;
  readonly symbols: ReadonlyArray<SymbolFile>;
  readonly skipped: ReadonlyArray<Skipped>;
  readonly thresholds: RangeReading['thresholds'];
  readonly churnDays: number;
  readonly sinceReview?: SinceReview;
};

type PageDataOptions = {
  readonly reading: RangeReading;
  readonly repo: string;
  readonly range: string;
  readonly version: string;
  readonly parsers: PageData['parsers'];
  readonly pullRequest?: PullRequest | undefined;
};

export const UNCOMMITTED = 'HEAD..worktree';

export const pageData = ({
  reading,
  repo,
  range,
  version,
  parsers,
  pullRequest,
}: PageDataOptions): PageData => {
  const diff = diffGraphs(reading);
  const isDrawn = ({ path }: FilePatch): boolean =>
    diff.nodes.some(node => isAtOrUnder(path, node));
  const metrics = nodeMetrics({ diff, ...reading });
  const undrawn = reading.patches.filter(patch => !isDrawn(patch));
  const order = readingOrder(diff);
  const findings = raisedFindings({
    skipped: reading.skipped,
    changedPaths: reading.changedPaths,
    undrawn,
    dangling: reading.danglingCalls,
    dependencyChanges: reading.dependencyChanges,
    metricFindings: metricFindings({ metrics, thresholds: reading.thresholds }),
    symbols: reading.symbols,
    symbolsNotRead: reading.symbolsNotRead,
    nodes: diff.nodes,
    tests: reading.tests,
    split: splitSuggestion({
      parts: order.parts,
      edges: diff.edges,
      splitParts: reading.thresholds.splitParts,
    }),
  });
  return {
    repo,
    range,
    version,
    parsers,
    ...(pullRequest === undefined ? {} : { pullRequest }),
    diff,
    readingOrder: order,
    metrics,
    findings,
    dangling: reading.danglingCalls,
    patches: reading.patches.filter(isDrawn),
    undrawn,
    dependencyChanges: reading.dependencyChanges,
    tests: reading.tests,
    symbols: reading.symbols,
    skipped: reading.skipped,
    thresholds: reading.thresholds,
    churnDays: reading.churnDays,
    ...(reading.reviewed === undefined
      ? {}
      : {
          sinceReview: sinceReviewOf({
            reviewed: reading.reviewed,
            after: reading.after,
            diff,
            changedPaths: reading.changedPaths,
            patches: reading.patches,
            symbols: reading.symbols,
            tests: reading.tests,
            findings,
          }),
        }),
  };
};

const DATA_SLOT = 'review-data';

const NOTES_SLOT = 'review-notes';

const SERVE_SLOT = 'review-serve';

const slot = (id: string, content: string) =>
  `<script type="application/json" id="${id}">${content}</script>`;

const filledSlot = (html: string, id: string, value: unknown): string =>
  html.replace(new RegExp(slot(id, '[\\s\\S]*?')), () =>
    slot(id, JSON.stringify(value).replaceAll('<', '\\u003c')),
  );

type PageHtmlOptions = {
  readonly viewer: string;
  readonly data: PageData;
};

export const pageHtml = ({ viewer, data }: PageHtmlOptions): string =>
  filledSlot(viewer, DATA_SLOT, data);

type Page = {
  readonly data: PageData;
  readonly notes: ReviewNotes | undefined;
  readonly token: string | undefined;
};

export const pageIn = (slotText: (id: string) => string | undefined): Page => {
  const data: PageData = JSON.parse(slotText(DATA_SLOT) ?? '{}');
  const notes: ReviewNotes | null = JSON.parse(slotText(NOTES_SLOT) ?? 'null');
  const token: string | null = JSON.parse(slotText(SERVE_SLOT) ?? 'null');
  return { data, notes: notes ?? undefined, token: token ?? undefined };
};

const slotsIn =
  (html: string) =>
  (id: string): string | undefined =>
    new RegExp(slot(id, '([\\s\\S]*?)')).exec(html)?.[1];

const writerOf = (version: string | undefined): string =>
  version === undefined ? 'an older visual-review' : `visual-review ${version}`;

type WrittenByOptions = {
  readonly page: string;
  readonly version: string;
  readonly advice: string;
};

const writtenBy = ({ page, version, advice }: WrittenByOptions): PageData => {
  const { data } = pageIn(slotsIn(page));
  if (data.version !== version) {
    throw new Error(
      `The page for ${data.range} was written by ${writerOf(data.version)}: ${advice}`,
    );
  }
  return data;
};

type NotedPageHtmlOptions = {
  readonly page: string;
  readonly notes: ReviewNotes;
  readonly notesFile: string;
  readonly version: string;
};

export const notedPageHtml = ({
  page,
  notes,
  notesFile,
  version,
}: NotedPageHtmlOptions): string => {
  const data = writtenBy({ page, version, advice: 'run visual-review without --notes first' });
  const problems = notesProblems({ diff: data.diff, notes });
  if (problems.length > 0) {
    throw new Error(`Notes in ${notesFile} don't match the graph:\n${problems.join('\n')}`);
  }
  return filledSlot(page, NOTES_SLOT, notes);
};

type ServedPageHtmlOptions = {
  readonly page: string;
  readonly token: string;
  readonly version: string;
};

export const servedPageHtml = ({ page, token, version }: ServedPageHtmlOptions): string => {
  writtenBy({ page, version, advice: 'run visual-review again to serve it' });
  return filledSlot(page, SERVE_SLOT, token);
};

type PingServeOptions = {
  readonly origin: string;
  readonly token: string;
};

export const pingServe = async ({ origin, token }: PingServeOptions): Promise<void> => {
  await fetch(`${origin}/${token}/ping`, { method: 'POST' });
};

type SendReviewOptions = {
  readonly origin: string;
  readonly token: string;
  readonly review: Review;
};

export const sendReview = async ({ origin, token, review }: SendReviewOptions): Promise<void> => {
  const response = await fetch(`${origin}/${token}/review`, {
    method: 'POST',
    body: JSON.stringify(review),
  });
  if (!response.ok) {
    throw new Error(`The review was not sent: ${response.status} ${response.statusText}`);
  }
};
