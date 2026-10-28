import type { DiffedEdge, GraphDiff } from '../diff-graphs.ts';
import type { GraphEdge } from '../graph.ts';
import type { Note } from '../notes.ts';

export const edgeId = (edge: GraphEdge): string => `${edge.from} -> ${edge.to}`;

const sameEnds = (one: DiffedEdge, other: DiffedEdge): boolean =>
  one.from === other.from && one.to === other.to;

const mergedState = (edges: ReadonlyArray<DiffedEdge>): DiffedEdge['state'] => {
  if (edges.every(edge => edge.state === 'added')) return 'added';
  if (edges.every(edge => edge.state === 'removed')) return 'removed';
  return 'unchanged';
};

type VisibleDiffOptions = {
  readonly diff: GraphDiff;
  readonly expanded: ReadonlySet<string>;
};

export const visibleNodeOf = ({ diff, expanded }: VisibleDiffOptions) => {
  const parentOf = new Map(diff.nodes.map(node => [node.id, node.parent]));
  const stacks = new Set(diff.nodes.filter(node => node.kind === 'stack').map(node => node.id));
  return (id: string): string => {
    const parent = parentOf.get(id);
    return parent === undefined || stacks.has(parent) || expanded.has(parent) ? id : parent;
  };
};

export const visibleDiff = ({ diff, expanded }: VisibleDiffOptions): GraphDiff => {
  const visibleOf = visibleNodeOf({ diff, expanded });
  const rerouted = diff.edges
    .map(edge => ({ ...edge, from: visibleOf(edge.from), to: visibleOf(edge.to) }))
    .filter(edge => edge.from !== edge.to);
  return {
    nodes: diff.nodes.filter(node => visibleOf(node.id) === node.id),
    edges: rerouted
      .filter((edge, index) => rerouted.findIndex(other => sameEnds(edge, other)) === index)
      .map(edge => {
        const merged = rerouted.filter(other => sameEnds(edge, other));
        const via = [...new Set(merged.flatMap(other => other.via ?? []))];
        return { ...edge, ...(via.length > 0 ? { via } : {}), state: mergedState(merged) };
      }),
  };
};

export const nearChanges = (diff: GraphDiff): GraphDiff => {
  const changed = new Set(
    diff.nodes.filter(node => node.state !== 'unchanged').map(node => node.id),
  );
  const near = [
    ...changed,
    ...diff.edges.flatMap(edge =>
      edge.state !== 'unchanged' || changed.has(edge.from) || changed.has(edge.to)
        ? [edge.from, edge.to]
        : [],
    ),
  ];
  const parentOf = new Map(diff.nodes.map(node => [node.id, node.parent]));
  const withAncestors = (id: string): ReadonlyArray<string> => {
    const parent = parentOf.get(id);
    return parent === undefined ? [id] : [id, ...withAncestors(parent)];
  };
  const kept = new Set(near.flatMap(withAncestors));
  return {
    nodes: diff.nodes.filter(node => kept.has(node.id)),
    edges: diff.edges.filter(edge => kept.has(edge.from) && kept.has(edge.to)),
  };
};

const joined = (one: Note, other: Note): Note => {
  const flags = [one.flag, other.flag].filter(flag => flag !== undefined);
  return {
    text: `${one.text} ${other.text}`,
    ...(flags.length > 0 ? { flag: flags.join(', ') } : {}),
  };
};

type VisibleNotesOptions = VisibleDiffOptions & {
  readonly notes: Readonly<Record<string, Note>>;
};

export const visibleNotes = ({
  diff,
  expanded,
  notes,
}: VisibleNotesOptions): Readonly<Record<string, Note>> => {
  const visibleOf = visibleNodeOf({ diff, expanded });
  const drawnIdOf = new Map(
    diff.edges.map(edge => [
      edgeId(edge),
      edgeId({ from: visibleOf(edge.from), to: visibleOf(edge.to) }),
    ]),
  );
  const placed = Object.entries(notes).map(([id, note]) => ({ id: drawnIdOf.get(id) ?? id, note }));
  return Object.fromEntries(
    [...new Set(placed.map(({ id }) => id))].map(id => [
      id,
      placed
        .filter(other => other.id === id)
        .map(({ note }) => note)
        .reduce(joined),
    ]),
  );
};
