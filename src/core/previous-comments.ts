import { anchorTarget, type TargetsOf } from './anchors.ts';
import { isAtOrUnder } from './diff-graphs.ts';
import type { GraphNode } from './graph.ts';
import type { Commit, ReviewedHead } from './read-range.ts';
import type { ChangedSince } from './since-review.ts';

type Said = ReviewedHead['comments'][number];

export type PreviousComment = Said & {
  readonly target?: string;
  readonly changedSince?: ReadonlyArray<Commit>;
};

type Compared = {
  readonly changed: ChangedSince;
  readonly commits: ReadonlyArray<Commit>;
  readonly tree: ReadonlyArray<Pick<GraphNode, 'id' | 'parent' | 'path'>>;
  readonly named: (id: string) => string;
};

type PreviousCommentsOptions = {
  readonly comments: ReadonlyArray<Said>;
  readonly targets: TargetsOf;
  readonly compared?: Compared;
};

const isInside = (tree: Compared['tree'], id: string, holder: string): boolean => {
  const parent = tree.find(node => node.id === id)?.parent;
  return id === holder || (parent !== undefined && isInside(tree, parent, holder));
};

const commitsOn = (compared: Compared, parts: ReadonlyArray<string>): ReadonlyArray<Commit> => {
  const nodes = compared.tree.filter(({ id }) =>
    parts.some(part => isInside(compared.tree, id, part)),
  );
  return compared.commits.filter(({ files }) =>
    files.some(file => nodes.some(node => isAtOrUnder(file, node))),
  );
};

const partChanged = (compared: Compared, targets: TargetsOf, id: string): boolean =>
  !targets.nodes.some(node => node.id === id) ||
  [...compared.changed.nodes, ...compared.changed.dropped.nodes].some(changed =>
    isInside(compared.tree, changed, id),
  );

const partMark = (compared: Compared, targets: TargetsOf, id: string) => {
  const head = compared.named(id);
  return partChanged(compared, targets, head)
    ? { changedSince: commitsOn(compared, [id, head]) }
    : {};
};

const targetIn = (targets: TargetsOf, id: string) =>
  targets.nodes.some(node => node.id === id) ? { target: id } : {};

export const previousComments = ({
  comments,
  targets,
  compared,
}: PreviousCommentsOptions): ReadonlyArray<PreviousComment> =>
  comments.map(comment => {
    if (comment.anchor.kind !== 'part') return comment;
    const { id } = comment.anchor;
    const target = anchorTarget({ ...comment.anchor, id: compared?.named(id) ?? id }, targets);
    return {
      ...comment,
      ...(target === undefined ? {} : targetIn(targets, target)),
      ...(compared === undefined ? {} : partMark(compared, targets, id)),
    };
  });
