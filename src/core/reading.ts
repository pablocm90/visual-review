import type { Config, DeployConfig, NotesConfig, ReaderName } from './config.ts';
import type { NamedColumn } from './deploy-columns.ts';
import type { FilePatch, Rename } from './diff-graphs.ts';
import type { Graph } from './graph.ts';
import type { DanglingCall } from './linker.ts';
import type { AccessReading } from './read-access.ts';
import type { DependencyChanges } from './read-lockfiles.ts';
import type { MigrationReading } from './read-migrations.ts';
import type { Reach } from './read-reaches.ts';
import type { RoutesReading } from './read-routes.ts';
import type { SchemaReading } from './read-schemas.ts';
import type { FileMeasures } from './reader.ts';
import type { Review } from './review.ts';
import type { RuleBreak } from './rule-breaks.ts';
import type { Skipped } from './skipped.ts';
import type { FileSymbolChanges } from './symbol-changes.ts';
import type { TestFile } from './test-changes.ts';

/*
 * What reading a range gives: both sides' graphs and what was read beside them. Types only, so the
 * page and the checks can take a reading without pulling in the I/O that `read-range.ts` does.
 */

export type Churn = Readonly<Record<string, number>>;

export type Measures = Readonly<Record<string, FileMeasures>>;

export type SymbolFile = { readonly stack: string } & (
  | FileSymbolChanges
  | { readonly node: string; readonly unreadable: string }
);

export type ReviewedHead = {
  readonly head: string;
  readonly verdict: Review['verdict'];
  readonly body?: string;
  readonly read: ReadonlyArray<string>;
  readonly comments: Review['comments'];
  readonly calledFine: ReadonlyArray<string>;
};

export type ReviewedDiff = {
  readonly before: Graph;
  readonly changedPaths: ReadonlyArray<string>;
  readonly renames: ReadonlyArray<Rename>;
  readonly symbols: ReadonlyArray<SymbolFile>;
  readonly tests: ReadonlyArray<TestFile>;
};

export type Commit = {
  readonly sha: string;
  readonly subject: string;
  readonly files: ReadonlyArray<string>;
};

export type ReviewedReading = ReviewedHead &
  (
    | { readonly gone: true }
    | { readonly unreadable: string }
    | (ReviewedDiff & {
        readonly after: Graph;
        readonly pullRequest: ReviewedDiff;
        readonly commits: ReadonlyArray<Commit>;
      })
  );

export type RangeReading = {
  readonly before: Graph;
  readonly after: Graph;
  readonly churn: { readonly before: Churn; readonly after: Churn };
  readonly measures: { readonly before: Measures; readonly after: Measures };
  readonly measuresNotRead: ReadonlyArray<string>;
  readonly changedPaths: ReadonlyArray<string>;
  readonly renames: ReadonlyArray<Rename>;
  readonly patches: ReadonlyArray<FilePatch>;
  readonly tests: ReadonlyArray<TestFile>;
  readonly symbols: ReadonlyArray<SymbolFile>;
  readonly symbolsNotRead: ReadonlyArray<string>;
  readonly reaches: ReadonlyArray<Reach>;
  readonly reachesNotRead: ReadonlyArray<string>;
  readonly dependencyChanges: ReadonlyArray<DependencyChanges>;
  readonly migrations: ReadonlyArray<MigrationReading>;
  readonly schemas: ReadonlyArray<SchemaReading>;
  /** The files at the head naming a column the schema dumps remove, by name. */
  readonly columnsNamedAtHead: ReadonlyArray<NamedColumn>;
  readonly routes: ReadonlyArray<RoutesReading>;
  readonly access: ReadonlyArray<AccessReading>;
  readonly openActions: ReadonlyArray<string>;
  readonly danglingCalls: ReadonlyArray<DanglingCall>;
  readonly linksNotRead: ReadonlyArray<string>;
  readonly skipped: ReadonlyArray<Skipped>;
  readonly readers: ReadonlyArray<ReaderName>;
  readonly thresholds: Omit<Config['metrics'], 'churnDays'>;
  readonly churnDays: number;
  readonly ruleBreaks: ReadonlyArray<RuleBreak>;
  readonly rulesNotRead: ReadonlyArray<string>;
  readonly deployKeysAtBase: ReadonlyArray<string>;
  readonly deployConfig: DeployConfig;
  readonly notesConfig: NotesConfig;
  readonly reviewed?: ReviewedReading;
};
