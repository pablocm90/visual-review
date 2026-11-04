import { anchorTarget, split, type TargetsOf } from './anchors.ts';
import { isAtOrUnder } from './diff-graphs.ts';
import { endsOfId, type GraphNode } from './graph.ts';
import type { Commit, ReviewedHead } from './read-range.ts';
import type { ChangedSince } from './since-review.ts';

type Said = ReviewedHead['comments'][number];

export type PreviousComment = Said & {
  readonly target?: string;
  readonly changedSince?: ReadonlyArray<Commit>;
};

type Compared = {
  readonly changed: ChangedSince;
  readonly held: Pick<ChangedSince, 'symbols' | 'decisions'>;
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

const isHeld = (targets: TargetsOf, id: string): boolean =>
  targets.nodes.some(node => node.id === id);

const partChanged = (compared: Compared, targets: TargetsOf, id: string): boolean =>
  !isHeld(targets, id) ||
  [...compared.changed.nodes, ...compared.changed.dropped.nodes].some(changed =>
    isInside(compared.tree, changed, id),
  );

const edgeChanged = (compared: Compared, targets: TargetsOf, id: string): boolean => {
  const [from, to] = split(id, ' -> ');
  return (
    !isHeld(targets, from) ||
    !isHeld(targets, to) ||
    [...compared.changed.edges, ...compared.changed.dropped.edges].some(edge => {
      const [edgeFrom, edgeTo] = split(edge, ' -> ');
      return isInside(compared.tree, edgeFrom, from) && isInside(compared.tree, edgeTo, to);
    })
  );
};

const nodesOf = ({ kind, id }: Said['anchor']): ReadonlyArray<string> =>
  kind === 'part' || kind === 'edge' ? endsOfId(id) : [split(id, '#')[0]];

const anchoredChanged = (compared: Compared, kind: 'symbols' | 'decisions', id: string): boolean =>
  !compared.held[kind].includes(id) || compared.changed[kind].includes(id);

const isChanged = (compared: Compared, targets: TargetsOf, { kind, id }: Said['anchor']) => {
  if (kind === 'part') return partChanged(compared, targets, compared.named(id));
  if (kind === 'edge') return edgeChanged(compared, targets, id);
  return anchoredChanged(compared, kind === 'symbol' ? 'symbols' : 'decisions', id);
};

const markOf = (compared: Compared, targets: TargetsOf, anchor: Said['anchor']) => {
  const nodes = nodesOf(anchor);
  return isChanged(compared, targets, anchor)
    ? { changedSince: commitsOn(compared, [...nodes, ...nodes.map(compared.named)]) }
    : {};
};

const targetIn = (targets: TargetsOf, id: string) =>
  endsOfId(id).every(end => isHeld(targets, end)) ? { target: id } : {};

const headId = ({ kind, id }: Said['anchor'], named: (id: string) => string): string => {
  if (kind === 'part' || kind === 'edge') return endsOfId(id).map(named).join(' -> ');
  const [node, rest] = split(id, '#');
  return `${named(node)}#${rest}`;
};

export const previousComments = ({
  comments,
  targets,
  compared,
}: PreviousCommentsOptions): ReadonlyArray<PreviousComment> =>
  comments.map(comment => {
    const { anchor } = comment;
    if (anchor.kind === 'test' || anchor.kind === 'line' || anchor.kind === 'finding')
      return comment;
    const id = headId(anchor, compared?.named ?? (end => end));
    const target = anchorTarget({ ...anchor, id }, targets);
    return {
      ...comment,
      ...(target === undefined ? {} : targetIn(targets, target)),
      ...(compared === undefined ? {} : markOf(compared, targets, anchor)),
    };
  });
