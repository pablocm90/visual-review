import type { ReaderName, StackSettings } from './config.ts';
import type { Graph, GraphNode } from './graph.ts';
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

export type AbcParts = {
  readonly assignments: number;
  readonly branches: number;
  readonly conditions: number;
};

export type FunctionMeasures = {
  readonly name: string;
  readonly cyclomatic: number;
  readonly earlyReturns?: number;
  readonly abc: AbcParts;
};

export type FileMeasures = {
  readonly lines: number;
  readonly functions: ReadonlyArray<FunctionMeasures>;
};

export type SymbolKind = 'function' | 'method' | 'getter' | 'setter' | 'class' | 'type';

export type DecisionKind =
  | 'guard'
  | 'if'
  | 'ternary'
  | 'loop'
  | 'case'
  | 'logical'
  | 'catch'
  | 'return'
  | 'throw'
  | 'try';

export type Decision = {
  readonly kind: DecisionKind;
  readonly text: string;
  readonly depth: number;
  readonly line: number;
  readonly foundByName?: true;
  readonly subject?: ReadonlyArray<string>;
};

export type LineRange = { readonly start: number; readonly end: number };

export type ReadSymbol = {
  readonly name: string;
  readonly scope?: string;
  readonly kind: SymbolKind;
  readonly lines: LineRange;
  readonly exported: boolean;
  readonly signature: string;
  readonly signatureHash: string;
  readonly bodyHash: string;
  readonly textHash: string;
  readonly bodyTokens: ReadonlyArray<string>;
  readonly decisions?: ReadonlyArray<Decision>;
  readonly risks?: ReadonlyArray<Risk>;
};

export type RiskKind = 'permit' | 'permit!' | 'raw-sql' | 'html-safe' | 'dynamic-send';

export type Risk = {
  readonly kind: RiskKind;
  readonly text: string;
  readonly detail?: string;
  readonly unread?: true;
};

export type FileSymbols = {
  readonly symbols: ReadonlyArray<ReadSymbol>;
  readonly exports: ReadonlyArray<string>;
  readonly astHash: string;
  readonly blindSpots?: ReadonlyArray<string>;
};

export type SymbolUse = {
  readonly path: string;
  readonly line: number;
  readonly text: string;
  readonly unfollowed?: true;
  readonly test?: boolean;
};

export type UsesAsked = {
  readonly base: string;
  readonly head: string;
  readonly stacks: ReadonlyMap<string, string>;
  readonly graph: Graph;
  readonly graphAtHead: Graph;
  readonly node: Pick<GraphNode, 'id' | 'path'>;
  readonly names: ReadonlyArray<string>;
};

export type UsesReading = {
  readonly uses: Readonly<Record<string, ReadonlyArray<SymbolUse>>>;
  readonly notRead: ReadonlyArray<string>;
  readonly notFollowed: ReadonlyArray<string>;
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
 * reader's stacks is read, and the review lists them as skipped. `graph` throws `StackNotRead`,
 * with the reason, for a stack it can't read: the review lists that stack as not read, and any
 * other throw fails it. `measure`, if it has one,
 * measures one of its files: its lines of code (not blank, not comment) and each function's
 * cyclomatic complexity and ABC parts; without it, its nodes get no complexity. A file it
 * measures as `undefined` is left unmeasured. `symbols`, if it has one, reads the symbols of one of
 * its files (functions, methods, classes and types, with their signatures and body hashes) and the
 * names the file exports; it throws on a file it can't parse. A file it reads as `undefined` has no
 * symbols, as every file of a reader without one. A symbol's `decisions` are its logic, each marked
 * `foundByName` when only a call's or a macro's name says it is one, and given a `subject`, the
 * names it decides on, when its text alone says them, so that it reads as changed only where the
 * head holds them all;
 * `blindSpots` names the calls and macros in the file that hide logic from this reading.
 * `uses`, if it has one, says where the files around a changed file use the names it exported at the
 * base: it takes the base's graph, since at the head a removed file has no edges into it, and the
 * head's checkout to read what they say now. A use's `test` says whether it sits in test code;
 * without it, its file being a test file says so.
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
  readonly measure?: (text: string, path: string) => FileMeasures | undefined;
  readonly symbols?: (text: string, path: string) => FileSymbols | undefined;
  readonly uses?: (asked: UsesAsked) => Promise<UsesReading>;
}
