import { diffGraphs, type FilePatch, type GraphDiff } from './diff-graphs.ts';
import { edgeId, type Graph } from './graph.ts';
import type { ReviewedHead, ReviewedReading, SymbolFile } from './read-range.ts';
import { isQuiet, qualified } from './symbol-changes.ts';
import { type AnchoredSymbol, anchoredSymbols } from './symbol-findings.ts';

type Changed = {
  readonly nodes: ReadonlyArray<string>;
  readonly edges: ReadonlyArray<string>;
  readonly symbols: ReadonlyArray<string>;
  readonly files: ReadonlyArray<string>;
};

export type ChangedSince = Changed & { readonly dropped: Changed };

export type SinceReview =
  | { readonly head: string; readonly gone: true }
  | { readonly head: string; readonly unreadable: string }
  | (ReviewedHead & { readonly changed: ChangedSince });

type SinceReviewOptions = {
  readonly reviewed: ReviewedReading;
  readonly after: Graph;
  readonly diff: GraphDiff;
  readonly changedPaths: ReadonlyArray<string>;
  readonly patches: ReadonlyArray<FilePatch>;
  readonly symbols: ReadonlyArray<SymbolFile>;
};

const changedIn = ({ nodes, edges }: GraphDiff) => ({
  nodes: nodes.filter(node => node.state !== 'unchanged').map(node => node.id),
  edges: edges.filter(edge => edge.state !== 'unchanged').map(edgeId),
});

const inTheHead = (ids: ReadonlyArray<string>, head: ReadonlyArray<string>) => ({
  drawn: ids.filter(id => head.includes(id)),
  dropped: ids.filter(id => !head.includes(id)),
});

type NamedInTheHeadOptions = {
  readonly reviewed: Graph;
  readonly after: Graph;
  readonly diff: GraphDiff;
};

const namedInTheHead = ({ reviewed, after, diff }: NamedInTheHeadOptions) => {
  const gone = reviewed.nodes.filter(node => !after.nodes.some(({ id }) => id === node.id));
  const renamedTo = new Map(
    diff.nodes.flatMap(({ id, renamedFrom }) =>
      gone.filter(node => node.path === renamedFrom).map(node => [node.id, id] as const),
    ),
  );
  return (id: string): string => renamedTo.get(id) ?? id;
};

const anchorsIn = (
  files: ReadonlyArray<SymbolFile>,
  nameOf: (node: string) => string = node => node,
): ReadonlyArray<AnchoredSymbol & { readonly node: string }> =>
  files.flatMap(file =>
    'unreadable' in file
      ? []
      : anchoredSymbols(nameOf(file.node), file.symbols).map(symbol => ({
          ...symbol,
          node: file.node,
        })),
  );

const idsChanged = (symbols: ReadonlyArray<AnchoredSymbol>): ReadonlyArray<string> =>
  symbols.filter(({ item }) => !isQuiet(item)).map(({ id }) => id);

const formerId = ({ id, node, item }: AnchoredSymbol & { readonly node: string }): string =>
  item.movedFrom === undefined && item.renamedFrom === undefined
    ? id
    : `${item.movedFrom ?? node}#${item.renamedFrom ?? qualified(item)}`;

export const sinceReviewOf = ({
  reviewed,
  after,
  diff,
  changedPaths,
  patches,
  symbols,
}: SinceReviewOptions): SinceReview => {
  if ('gone' in reviewed) return { head: reviewed.head, gone: true };
  if ('unreadable' in reviewed) return { head: reviewed.head, unreadable: reviewed.unreadable };
  const { head, verdict, pullRequest, ...side } = reviewed;
  const paths = [...changedPaths, ...pullRequest.changedPaths];
  const pathsSince = side.changedPaths.filter(path => paths.includes(path));
  const sinceDiff = diffGraphs({ ...side, after, changedPaths: pathsSince });
  const since = changedIn(sinceDiff);
  const now = changedIn(diff);
  const named = namedInTheHead({ reviewed: side.before, after, diff: sinceDiff });
  const atReview = diffGraphs({ ...pullRequest, after: side.before });
  const then = changedIn({
    nodes: atReview.nodes.map(node => ({ ...node, id: named(node.id) })),
    edges: atReview.edges.map(edge => ({ ...edge, from: named(edge.from), to: named(edge.to) })),
  });
  const nodes = inTheHead(
    since.nodes.filter(id => now.nodes.includes(id) || then.nodes.includes(id)),
    diff.nodes.map(node => node.id),
  );
  const edges = inTheHead(
    since.edges.filter(id => now.edges.includes(id) || then.edges.includes(id)),
    diff.edges.map(edgeId),
  );
  const files = inTheHead(
    pathsSince.filter(path => !side.renames.some(({ from }) => from === path)),
    patches.map(({ path }) => path),
  );
  const headSymbols = anchorsIn(symbols);
  const symbolsNow = idsChanged(headSymbols);
  const symbolsThen = idsChanged(anchorsIn(pullRequest.symbols, named));
  const symbolsSince = inTheHead(
    anchorsIn(side.symbols)
      .filter(({ item }) => !isQuiet(item))
      .filter(symbol => symbolsNow.includes(symbol.id) || symbolsThen.includes(formerId(symbol)))
      .map(({ id }) => id),
    headSymbols.map(({ id }) => id),
  );
  return {
    head,
    verdict,
    changed: {
      nodes: nodes.drawn,
      edges: edges.drawn,
      symbols: symbolsSince.drawn,
      files: files.drawn,
      dropped: {
        nodes: nodes.dropped,
        edges: edges.dropped,
        symbols: symbolsSince.dropped,
        files: files.dropped,
      },
    },
  };
};
