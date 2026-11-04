import type { GraphDiff } from './diff-graphs.ts';

type SplitOptions = {
  readonly parts: ReadonlyArray<string>;
  readonly edges: GraphDiff['edges'];
};

export type SplitSuggestion = {
  readonly groups: ReadonlyArray<ReadonlyArray<string>>;
};

type Neighbours = ReadonlyMap<string, ReadonlyArray<string>>;

const neighboursOf = (edges: GraphDiff['edges']): Neighbours =>
  new Map(
    [
      ...Map.groupBy(
        edges.flatMap(({ from, to }) => [
          { end: from, other: to },
          { end: to, other: from },
        ]),
        ({ end }) => end,
      ),
    ].map(([end, ends]) => [end, ends.map(({ other }) => other)]),
  );

const spread = (
  seen: ReadonlySet<string>,
  frontier: ReadonlyArray<string>,
  neighbours: Neighbours,
): ReadonlySet<string> => {
  const next = [
    ...new Set(frontier.flatMap(id => neighbours.get(id) ?? []).filter(id => !seen.has(id))),
  ];
  return next.length === 0 ? seen : spread(new Set([...seen, ...next]), next, neighbours);
};

export const splitSuggestion = ({ parts, edges }: SplitOptions): SplitSuggestion => {
  const isPart = new Set(parts);
  const neighbours = neighboursOf(
    edges.filter(({ from, to }) => isPart.has(from) && isPart.has(to)),
  );
  const { groups } = parts.reduce<{
    readonly seen: ReadonlySet<string>;
    readonly groups: SplitSuggestion['groups'];
  }>(
    (walked, part) => {
      if (walked.seen.has(part)) return walked;
      const joined = spread(new Set([part]), [part], neighbours);
      return {
        seen: new Set([...walked.seen, ...joined]),
        groups: [...walked.groups, parts.filter(each => joined.has(each))],
      };
    },
    { seen: new Set(), groups: [] },
  );
  return { groups };
};
