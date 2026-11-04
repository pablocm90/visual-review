import { diffGraphs, type GraphDiff } from './diff-graphs.ts';
import { edgeId, type Graph } from './graph.ts';
import type { ReviewedHead, ReviewedReading } from './read-range.ts';

export type SinceReview =
  | { readonly head: string; readonly gone: true }
  | (ReviewedHead & {
      readonly changed: {
        readonly nodes: ReadonlyArray<string>;
        readonly edges: ReadonlyArray<string>;
      };
    });

type SinceReviewOptions = {
  readonly reviewed: ReviewedReading;
  readonly after: Graph;
  readonly diff: GraphDiff;
};

const changedIn = ({ nodes, edges }: GraphDiff) => ({
  nodes: nodes.filter(node => node.state !== 'unchanged').map(node => node.id),
  edges: edges.filter(edge => edge.state !== 'unchanged').map(edgeId),
});

export const sinceReviewOf = ({ reviewed, after, diff }: SinceReviewOptions): SinceReview => {
  if ('gone' in reviewed) return { head: reviewed.head, gone: true };
  const { head, verdict, ...side } = reviewed;
  const since = changedIn(diffGraphs({ ...side, after }));
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
