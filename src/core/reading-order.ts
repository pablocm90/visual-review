import type { GraphDiff } from './diff-graphs.ts';

export type ReadingOrder = {
  readonly parts: ReadonlyArray<string>;
};

const ordered = (
  parts: ReadonlyArray<string>,
  dependsOn: (part: string, other: string) => boolean,
): ReadonlyArray<string> => {
  const [next] = parts.filter(part => !parts.some(other => dependsOn(part, other)));
  return next === undefined
    ? []
    : [
        next,
        ...ordered(
          parts.filter(part => part !== next),
          dependsOn,
        ),
      ];
};

export const readingOrder = (diff: GraphDiff): ReadingOrder => {
  const parents = new Set(diff.nodes.flatMap(node => node.parent ?? []));
  const parts = diff.nodes
    .filter(node => node.state !== 'unchanged' && !parents.has(node.id))
    .map(node => node.id);
  const reached = (from: ReadonlySet<string>): ReadonlySet<string> => {
    const next = new Set([
      ...from,
      ...diff.edges.filter(edge => from.has(edge.from)).map(edge => edge.to),
    ]);
    return next.size === from.size ? from : reached(next);
  };
  const reach = new Map(parts.map(part => [part, reached(new Set([part]))]));
  const dependsOn = (part: string, other: string): boolean =>
    part !== other && (reach.get(part)?.has(other) ?? false);
  return { parts: ordered(parts, dependsOn) };
};
