import type { PullRequest } from '../git/pull-request.ts';
import type { FilePatch, GraphDiff } from './diff-graphs.ts';
import type { DanglingCall } from './linker.ts';
import type { ReviewNotes } from './notes.ts';
import type { Skipped } from './skipped.ts';
import type { TestFile } from './test-changes.ts';

export type ReviewData = {
  readonly range: string;
  readonly pullRequest?: PullRequest;
  readonly diff: GraphDiff;
  readonly dangling?: ReadonlyArray<DanglingCall>;
  readonly patches?: ReadonlyArray<FilePatch>;
  readonly undrawn?: ReadonlyArray<FilePatch>;
  readonly tests?: ReadonlyArray<TestFile>;
  readonly notes?: ReviewNotes;
  readonly skipped?: ReadonlyArray<Skipped>;
};
