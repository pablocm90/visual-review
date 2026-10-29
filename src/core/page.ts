import { diffGraphs, type FilePatch, type GraphDiff, isAtOrUnder } from './diff-graphs.ts';
import type { DanglingCall } from './linker.ts';
import type { RangeReading } from './read-range.ts';
import type { Skipped } from './skipped.ts';
import type { TestFile } from './test-changes.ts';

export type PullRequest = {
  readonly number: number;
  readonly title: string;
  readonly url: string;
};

export type PageData = {
  readonly range: string;
  readonly pullRequest?: PullRequest;
  readonly diff: GraphDiff;
  readonly dangling: ReadonlyArray<DanglingCall>;
  readonly patches: ReadonlyArray<FilePatch>;
  readonly undrawn: ReadonlyArray<FilePatch>;
  readonly tests: ReadonlyArray<TestFile>;
  readonly skipped: ReadonlyArray<Skipped>;
};

type PageDataOptions = {
  readonly reading: RangeReading;
  readonly range: string;
  readonly pullRequest?: PullRequest | undefined;
};

export const pageData = ({ reading, range, pullRequest }: PageDataOptions): PageData => {
  const diff = diffGraphs(reading);
  const isDrawn = ({ path }: FilePatch): boolean =>
    diff.nodes.some(node => isAtOrUnder(path, node));
  return {
    range,
    ...(pullRequest === undefined ? {} : { pullRequest }),
    diff,
    dangling: reading.danglingCalls,
    patches: reading.patches.filter(isDrawn),
    undrawn: reading.patches.filter(patch => !isDrawn(patch)),
    tests: reading.tests,
    skipped: reading.skipped,
  };
};
