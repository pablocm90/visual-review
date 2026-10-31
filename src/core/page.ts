import { diffGraphs, type FilePatch, type GraphDiff, isAtOrUnder } from './diff-graphs.ts';
import type { DanglingCall } from './linker.ts';
import { type MetricFinding, metricFindings } from './metric-findings.ts';
import { type NodeMetrics, nodeMetrics } from './metrics.ts';
import { notesProblems, type ReviewNotes } from './notes.ts';
import type { RangeReading } from './read-range.ts';
import type { Skipped } from './skipped.ts';
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
  readonly pullRequest?: PullRequest;
  readonly diff: GraphDiff;
  readonly metrics: Readonly<Record<string, NodeMetrics>>;
  readonly metricFindings: ReadonlyArray<MetricFinding>;
  readonly dangling: ReadonlyArray<DanglingCall>;
  readonly patches: ReadonlyArray<FilePatch>;
  readonly undrawn: ReadonlyArray<FilePatch>;
  readonly tests: ReadonlyArray<TestFile>;
  readonly skipped: ReadonlyArray<Skipped>;
};

type PageDataOptions = {
  readonly reading: RangeReading;
  readonly repo: string;
  readonly range: string;
  readonly version: string;
  readonly pullRequest?: PullRequest | undefined;
};

export const pageData = ({
  reading,
  repo,
  range,
  version,
  pullRequest,
}: PageDataOptions): PageData => {
  const diff = diffGraphs(reading);
  const isDrawn = ({ path }: FilePatch): boolean =>
    diff.nodes.some(node => isAtOrUnder(path, node));
  const metrics = nodeMetrics({ diff, ...reading });
  return {
    repo,
    range,
    version,
    ...(pullRequest === undefined ? {} : { pullRequest }),
    diff,
    metrics,
    metricFindings: metricFindings({ metrics, thresholds: reading.thresholds }),
    dangling: reading.danglingCalls,
    patches: reading.patches.filter(isDrawn),
    undrawn: reading.patches.filter(patch => !isDrawn(patch)),
    tests: reading.tests,
    skipped: reading.skipped,
  };
};

const DATA_SLOT = 'review-data';

const NOTES_SLOT = 'review-notes';

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
};

export const pageIn = (slotText: (id: string) => string | undefined): Page => {
  const data: PageData = JSON.parse(slotText(DATA_SLOT) ?? '{}');
  const notes: ReviewNotes | null = JSON.parse(slotText(NOTES_SLOT) ?? 'null');
  return { data, notes: notes ?? undefined };
};

const slotsIn =
  (html: string) =>
  (id: string): string | undefined =>
    new RegExp(slot(id, '([\\s\\S]*?)')).exec(html)?.[1];

const writerOf = (version: string | undefined): string =>
  version === undefined ? 'an older visual-review' : `visual-review ${version}`;

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
  const { data } = pageIn(slotsIn(page));
  if (data.version !== version) {
    throw new Error(
      `The page for ${data.range} was written by ${writerOf(data.version)}: run visual-review without --notes first`,
    );
  }
  const problems = notesProblems({ diff: data.diff, notes });
  if (problems.length > 0) {
    throw new Error(`Notes in ${notesFile} don't match the graph:\n${problems.join('\n')}`);
  }
  return filledSlot(page, NOTES_SLOT, notes);
};
