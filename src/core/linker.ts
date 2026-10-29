import type { LinkerName, ReaderName } from './config.ts';
import type { GraphEdge, GraphNode } from './graph.ts';

export type DanglingCall = {
  readonly from: string;
  readonly path: string;
};

export type LinkedStack = {
  readonly stack: string;
  readonly nodes: ReadonlyArray<GraphNode>;
};

export type Links = {
  readonly edges: ReadonlyArray<GraphEdge>;
  readonly dangling: ReadonlyArray<DanglingCall>;
};

export type LinkOptions = {
  readonly directory: string;
  readonly from: ReadonlyArray<LinkedStack>;
  readonly to: ReadonlyArray<LinkedStack>;
};

/**
 * Draws edges across stacks. `link` is given the checkout's directory and every stack the config
 * keeps of the `from` reader and of the `to` reader, or those the config's `linkers` entry names,
 * each with its nodes, whose paths are relative to the checkout; a skipped reader's stacks come
 * with none. It returns edges between those nodes' ids, and the calls from a `from` node that
 * reach nothing in the `to` stacks.
 */
export interface Linker {
  readonly name: LinkerName;
  readonly from: ReaderName;
  readonly to: ReaderName;
  readonly link: (options: LinkOptions) => Promise<Links>;
}
