import type { GraphDiff } from './diff-graphs.ts';

export type ReadingOrder = {
  readonly parts: ReadonlyArray<string>;
  readonly cycles: ReadonlyArray<ReadonlyArray<string>>;
};

type Group = ReadonlyArray<string>;

type Reaches = (part: string, other: string) => boolean;

const ordered = (groups: ReadonlyArray<Group>, reaches: Reaches): ReadonlyArray<Group> => {
  const dependsOn = (group: Group, other: Group): boolean =>
    other !== group && group.some(part => other.some(target => reaches(part, target)));
  const [next] = groups.filter(group => !groups.some(other => dependsOn(group, other)));
  return next === undefined
    ? []
    : [
        next,
        ...ordered(
          groups.filter(group => group !== next),
          reaches,
        ),
      ];
};

export const readingOrder = (diff: GraphDiff): ReadingOrder => {
  const parents = new Set(diff.nodes.flatMap(node => node.parent ?? []));
  const parts = diff.nodes
    .filter(node => node.state !== 'unchanged' && !parents.has(node.id))
    .map(node => node.id)
    .toSorted();
  const removed = new Set(diff.nodes.filter(node => node.state === 'removed').map(node => node.id));
  const reached = (from: ReadonlySet<string>): ReadonlySet<string> => {
    const next = new Set([
      ...from,
      ...diff.edges.filter(edge => from.has(edge.from)).map(edge => edge.to),
    ]);
    return next.size === from.size ? from : reached(next);
  };
  const reach = new Map(parts.map(part => [part, reached(new Set([part]))]));
  const reaches: Reaches = (part, other) => reach.get(part)?.has(other) ?? false;
  const groupOf = (part: string): Group =>
    parts.filter(other => reaches(part, other) && reaches(other, part));
  const groups = [...new Map(parts.map(part => [groupOf(part).join(' '), groupOf(part)])).values()];
  const isRemoved = (group: Group): boolean => group.some(part => removed.has(part));
  const order = ordered(
    groups.filter(group => !isRemoved(group)),
    reaches,
  );
  return {
    parts: [...order.flat(), ...groups.filter(isRemoved).flat()],
    cycles: order.filter(group => group.length > 1),
  };
};
