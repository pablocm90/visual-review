import type { DiffedEdge, GraphDiff } from './diff-graphs.ts';

const sameEnds = (one: DiffedEdge, other: DiffedEdge): boolean =>
  one.from === other.from && one.to === other.to;

const mergedState = (edges: ReadonlyArray<DiffedEdge>): DiffedEdge['state'] => {
  if (edges.every(edge => edge.state === 'added')) return 'added';
  if (edges.every(edge => edge.state === 'removed')) return 'removed';
  return 'unchanged';
};

export type VisibleDiffOptions = {
  readonly diff: GraphDiff;
  readonly expanded: ReadonlySet<string>;
};

export const visibleNodeOf = ({ diff, expanded }: VisibleDiffOptions) => {
  const parentOf = new Map(diff.nodes.map(node => [node.id, node.parent]));
  const stacks = new Set(diff.nodes.filter(node => node.kind === 'stack').map(node => node.id));
  const boxesAbove = (id: string): ReadonlyArray<string> => {
    const parent = parentOf.get(id);
    return parent === undefined || stacks.has(parent) ? [] : [...boxesAbove(parent), parent];
  };
  return (id: string): string => boxesAbove(id).find(box => !expanded.has(box)) ?? id;
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
