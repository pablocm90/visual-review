import { anchorTarget, fileOfLine, split, type TargetsOf } from './anchors.ts';
import type { Rename } from './diff-graphs.ts';
import { isAtOrUnder } from './diff-graphs.ts';
import { type Finding, targetOfNoteFlag } from './findings.ts';
import { endsOfId, type GraphNode } from './graph.ts';
import type { Commit, ReviewedHead } from './read-range.ts';
import type { ChangedSince } from './since-review.ts';

type Said = ReviewedHead['comments'][number];

export type PreviousComment = Said & {
  readonly target?: string;
  readonly changedSince?: ReadonlyArray<Commit>;
};

export type Compared = {
  readonly changed: ChangedSince;
  readonly held: Pick<ChangedSince, 'symbols' | 'decisions' | 'tests' | 'files'>;
  readonly renames: ReadonlyArray<Rename>;
  readonly commits: ReadonlyArray<Commit>;
  readonly tree: ReadonlyArray<Pick<GraphNode, 'id' | 'parent' | 'path'>>;
  readonly named: (id: string) => string;
};

type PreviousCommentsOptions = {
  readonly comments: ReadonlyArray<Said>;
  readonly targets: TargetsOf;
  readonly findings: ReadonlyArray<Finding>;
  readonly compared?: Compared;
};

export const isInside = (tree: Compared['tree'], id: string, holder: string): boolean => {
  const parent = tree.find(node => node.id === id)?.parent;
  return id === holder || (parent !== undefined && isInside(tree, parent, holder));
};

const commitsOn = (compared: Compared, parts: ReadonlyArray<string>): ReadonlyArray<Commit> => {
  const { nodes: changed, dropped } = compared.changed;
  const inside = [...changed, ...dropped.nodes].filter(id =>
    parts.some(part => isInside(compared.tree, id, part)),
  );
  const nodes = compared.tree.filter(({ id }) => parts.includes(id) || inside.includes(id));
  return compared.commits.filter(({ files }) =>
    files.some(file => nodes.some(node => isAtOrUnder(file, node))),
  );
};

const isHeld = (targets: TargetsOf, id: string): boolean =>
  targets.nodes.some(node => node.id === id);

export const partChanged = (compared: Compared, targets: TargetsOf, id: string): boolean =>
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

type InAFile = Extract<Said['anchor'], { readonly kind: 'test' | 'line' }>;

const fileOf = ({ kind, id }: InAFile): string =>
  kind === 'test' ? split(id, '#')[0] : fileOfLine(id);

const isInAFile = (anchor: Said['anchor']): anchor is InAFile =>
  anchor.kind === 'test' || anchor.kind === 'line';

const headFile = ({ renames }: Compared, file: string): string =>
  renames.find(({ from }) => from === file)?.to ?? file;

const commitsOf = (compared: Compared, anchor: Said['anchor']): ReadonlyArray<Commit> => {
  if (isInAFile(anchor)) {
    const file = fileOf(anchor);
    const head = headFile(compared, file);
    return compared.commits.filter(({ files }) => files.includes(file) || files.includes(head));
  }
  const nodes =
    anchor.kind === 'part' || anchor.kind === 'edge'
      ? endsOfId(anchor.id)
      : [split(anchor.id, '#')[0]];
  return commitsOn(compared, [...nodes, ...nodes.map(compared.named)]);
};

const listed = (compared: Compared, kind: keyof Compared['held'], id: string): boolean =>
  !compared.held[kind].includes(id) || compared.changed[kind].includes(id);

const isChanged = (compared: Compared, targets: TargetsOf, { kind, id }: Said['anchor']) => {
  if (kind === 'part') return partChanged(compared, targets, compared.named(id));
  if (kind === 'edge') return edgeChanged(compared, targets, id);
  if (kind === 'symbol') return listed(compared, 'symbols', id);
  if (kind === 'decision') return listed(compared, 'decisions', id);
  if (kind === 'test') return listed(compared, 'tests', id);
  return listed(compared, 'files', fileOfLine(id));
};

const markOf = (compared: Compared, targets: TargetsOf, anchor: Said['anchor']) =>
  isChanged(compared, targets, anchor) ? { changedSince: commitsOf(compared, anchor) } : {};

const targetIn = (targets: TargetsOf, id: string) =>
  endsOfId(id).every(end => isHeld(targets, end)) ? { target: id } : {};

const headId = (compared: Compared, anchor: Said['anchor']): string => {
  const { kind, id } = anchor;
  if (isInAFile(anchor)) {
    const file = fileOf(anchor);
    return `${headFile(compared, file)}${id.slice(file.length)}`;
  }
  if (kind === 'part' || kind === 'edge') return endsOfId(id).map(compared.named).join(' -> ');
  const [node, rest] = split(id, '#');
  return `${compared.named(node)}#${rest}`;
};

type OnASubject = Exclude<Said['anchor'], { readonly kind: 'finding' }>;

const onTheGraph = (target: string): OnASubject =>
  target.includes(' -> ') ? { kind: 'edge', id: target } : { kind: 'part', id: target };

export const previousComments = ({
  comments,
  targets,
  findings,
  compared,
}: PreviousCommentsOptions): ReadonlyArray<PreviousComment> => {
  const placed = (comment: Said, anchor: OnASubject): PreviousComment => {
    const id = compared === undefined ? anchor.id : headId(compared, anchor);
    const target = anchorTarget({ ...anchor, id }, targets);
    return {
      ...comment,
      ...(target === undefined ? {} : targetIn(targets, target)),
      ...(compared === undefined ? {} : markOf(compared, targets, anchor)),
    };
  };
  return comments.map(comment => {
    const { anchor } = comment;
    if (anchor.kind !== 'finding') return placed(comment, anchor);
    const raised = findings.find(({ id }) => id === anchor.id);
    const target = targetOfNoteFlag(anchor.id) ?? raised?.target;
    if (target !== undefined) return placed(comment, onTheGraph(target));
    return raised === undefined && compared !== undefined
      ? { ...comment, changedSince: [] }
      : comment;
  });
};
