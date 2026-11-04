import { diffGraphs, type GraphDiff } from './diff-graphs.ts';
import { edgeId, type Graph } from './graph.ts';
import type { ReviewedHead, ReviewedReading } from './read-range.ts';

export type ChangedSince = {
  readonly nodes: ReadonlyArray<string>;
  readonly edges: ReadonlyArray<string>;
  readonly dropped: {
    readonly nodes: ReadonlyArray<string>;
    readonly edges: ReadonlyArray<string>;
  };
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

const inTheHead = (ids: ReadonlyArray<string>, head: ReadonlyArray<string>) => ({
  drawn: ids.filter(id => head.includes(id)),
  dropped: ids.filter(id => !head.includes(id)),
});

export const sinceReviewOf = ({
  reviewed,
  after,
  diff,
  changedPaths,
}: SinceReviewOptions): SinceReview => {
  if ('gone' in reviewed) return { head: reviewed.head, gone: true };
  if ('unreadable' in reviewed) return { head: reviewed.head, unreadable: reviewed.unreadable };
  const { head, verdict, pullRequest, ...side } = reviewed;
  const paths = [...changedPaths, ...pullRequest.changedPaths];
  const since = changedIn(
    diffGraphs({
      ...side,
      after,
      changedPaths: side.changedPaths.filter(path => paths.includes(path)),
    }),
  );
  const now = changedIn(diff);
  const then = changedIn(diffGraphs({ ...pullRequest, after: side.before }));
  const nodes = inTheHead(
    since.nodes.filter(id => now.nodes.includes(id) || then.nodes.includes(id)),
    diff.nodes.map(node => node.id),
  );
  const edges = inTheHead(
    since.edges.filter(id => now.edges.includes(id) || then.edges.includes(id)),
    diff.edges.map(edgeId),
  );
  return {
    head,
    verdict,
    changed: {
      nodes: nodes.drawn,
      edges: edges.drawn,
      dropped: { nodes: nodes.dropped, edges: edges.dropped },
    },
  };
};
