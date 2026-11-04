import { diffGraphs, type GraphDiff } from './diff-graphs.ts';
import { edgeId, type Graph } from './graph.ts';
import type { ReviewedHead, ReviewedReading } from './read-range.ts';

export type ChangedSince = {
  readonly nodes: ReadonlyArray<string>;
  readonly edges: ReadonlyArray<string>;
};

export type SinceReview =
  | { readonly head: string; readonly gone: true }
  | { readonly head: string; readonly unreadable: string }
  | (ReviewedHead & { readonly changed: ChangedSince });

type SinceReviewOptions = {
  readonly reviewed: ReviewedReading;
  readonly after: Graph;
  readonly diff: GraphDiff;
  readonly changedPaths: ReadonlyArray<string>;
};

const changedIn = ({ nodes, edges }: GraphDiff) => ({
  nodes: nodes.filter(node => node.state !== 'unchanged').map(node => node.id),
  edges: edges.filter(edge => edge.state !== 'unchanged').map(edgeId),
});

export const sinceReviewOf = ({
  reviewed,
  after,
  diff,
  changedPaths,
}: SinceReviewOptions): SinceReview => {
  if ('gone' in reviewed) return { head: reviewed.head, gone: true };
  if ('unreadable' in reviewed) return { head: reviewed.head, unreadable: reviewed.unreadable };
  const { head, verdict, ...side } = reviewed;
  const since = changedIn(
    diffGraphs({
      ...side,
      after,
      changedPaths: side.changedPaths.filter(path => changedPaths.includes(path)),
    }),
  );
  const parts = changedIn(diff);
  return {
    head,
    verdict,
    changed: {
      nodes: since.nodes.filter(id => parts.nodes.includes(id)),
      edges: since.edges.filter(id => parts.edges.includes(id)),
    },
  };
};
