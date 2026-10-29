import type { ReaderName, StackSettings } from './config.ts';
import type { Graph } from './graph.ts';
import type { ReadTest } from './test-changes.ts';

export type CandidateRoot = {
  readonly root: string;
  readonly name?: string;
};

export type HoldsOptions = {
  readonly directory: string;
  readonly root: string;
  readonly settings: StackSettings;
};

export type StackOptions = HoldsOptions & {
  readonly stack: string;
  readonly stacks: ReadonlyMap<string, string>;
};

/**
 * Reads the stacks of one kind in a checkout. `roots` lists the directories, relative to the
 * checkout, where one of its stacks may be, each with the name its stack goes by if it has one of
 * its own (else the core names it after its directory, or the reviewed repo's folder at `.`).
 * `holds` says whether a root is one of its stacks, given the settings the config has for the id
 * the stack would be drawn under; config-added roots are asked too. `graph` reads one stack into
 * nodes and edges under its drawn id, given every root of this reader's drawn stacks and its id.
 * The reader also owns its test files, saying which paths they are and how their tests read.
 * `tool` names the command its `graph` runs, if any: when it isn't on `PATH`, none of the
 * reader's stacks is read, and the review lists them as skipped.
 */
export interface Reader {
  readonly name: ReaderName;
  readonly tool?: string;
  readonly stackFields: ReadonlyArray<string>;
  readonly roots: (directory: string) => ReadonlyArray<CandidateRoot>;
  readonly holds: (options: HoldsOptions) => boolean;
  readonly graph: (options: StackOptions) => Promise<Graph>;
  readonly isTestFile: (path: string) => boolean;
  readonly readTests: (text: string) => ReadonlyArray<ReadTest>;
}
