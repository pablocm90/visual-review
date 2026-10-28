import type { Config, ReaderName } from './config.ts';
import type { Graph } from './graph.ts';
import type { ReadTest } from './test-statements.ts';

export type Checkout = {
  readonly directory: string;
  readonly repoName: string;
  readonly config: Config;
  readonly taken: ReadonlySet<string>;
};

export type OpenedCheckout = {
  readonly stacks: ReadonlyMap<string, string>;
  readonly graph: (root: string) => Promise<Graph>;
};

/**
 * Reads one stack of a checkout. `open` looks at a checkout once, given the reviewed repo's folder
 * name for a stack with no name of its own, the review's config and the ids readers before it took: `stacks` maps each directory,
 * relative to the checkout, where a stack is found (none when it isn't) to the id the stack is
 * drawn under, and `graph` reads one of those roots into nodes and edges. The reader also owns its
 * test files, saying which paths they are and how their tests read. `tool` names the command its
 * `graph` runs, if any: when it isn't on `PATH`, none of the reader's stacks is read, and the
 * review lists them as skipped.
 */
export interface Reader {
  readonly name: ReaderName;
  readonly tool?: string;
  readonly stackFields: ReadonlyArray<string>;
  readonly open: (checkout: Checkout) => OpenedCheckout;
  readonly isTestFile: (path: string) => boolean;
  readonly readTests: (text: string) => ReadonlyArray<ReadTest>;
}
