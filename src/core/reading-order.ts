import type { GraphDiff } from './diff-graphs.ts';

export type ReadingOrder = {
  readonly parts: ReadonlyArray<string>;
  readonly cycles: ReadonlyArray<ReadonlyArray<string>>;
};

type Group = ReadonlyArray<string>;

type Graph = ReadonlyMap<string, ReadonlyArray<string>>;

type Walk = { readonly seen: ReadonlySet<string>; readonly order: ReadonlyArray<string> };

const unwalked: Walk = { seen: new Set(), order: [] };

const walk = (graph: Graph, id: string, from: Walk): Walk => {
  if (from.seen.has(id)) return from;
  const after = (graph.get(id) ?? []).reduce<Walk>((walked, next) => walk(graph, next, walked), {
    ...from,
    seen: new Set([...from.seen, id]),
  });
  return { ...after, order: [...after.order, id] };
};

const reversed = (ids: ReadonlyArray<string>, graph: Graph): Graph => {
  const arrows = ids.flatMap(from => (graph.get(from) ?? []).map(to => ({ from, to })));
  return new Map(
    [...Map.groupBy(arrows, arrow => arrow.to)].map(([to, into]) => [
      to,
      into.map(arrow => arrow.from),
    ]),
  );
};

const stronglyConnected = (ids: ReadonlyArray<string>, graph: Graph): ReadonlyArray<Group> => {
  const back = reversed(ids, graph);
  return ids
    .reduce<Walk>((walked, id) => walk(graph, id, walked), unwalked)
    .order.toReversed()
    .reduce<{ readonly walked: Walk; readonly groups: ReadonlyArray<Group> }>(
      ({ walked, groups }, id) => {
        const after = walk(back, id, walked);
        const group = after.order.slice(walked.order.length);
        return {
          walked: after,
          groups: [...groups, group.toSorted()],
        };
      },
      { walked: unwalked, groups: [] },
    ).groups;
};

type Reading = {
  readonly ready: ReadonlyArray<number>;
  readonly waiting: ReadonlyMap<number, number>;
  readonly order: ReadonlyArray<number>;
};

const dependedUponFirst = (groups: ReadonlyArray<Group>, graph: Graph): ReadonlyArray<Group> => {
  const sorted = groups.toSorted((one, other) => ((one[0] ?? '') < (other[0] ?? '') ? -1 : 1));
  const indexOf = new Map(sorted.flatMap((group, index) => group.map(part => [part, index])));
  const dependsOn = sorted.map(
    (group, index) =>
      new Set(
        group
          .flatMap(part => graph.get(part) ?? [])
          .flatMap(target => indexOf.get(target) ?? [])
          .filter(other => other !== index),
      ),
  );
  const dependents = Map.groupBy(
    dependsOn.flatMap((others, index) => [...others].map(other => ({ other, index }))),
    ({ other }) => other,
  );
  const read = sorted.reduce<Reading>(
    ({ ready, waiting, order }) => {
      const [next, ...rest] = ready;
      if (next === undefined) return { ready, waiting, order };
      const waitingOnNext = (dependents.get(next) ?? []).map(({ index }) => index);
      const left = new Map([
        ...waiting,
        ...waitingOnNext.map((index): [number, number] => [index, (waiting.get(index) ?? 0) - 1]),
      ]);
      return {
        ready: [...rest, ...waitingOnNext.filter(index => left.get(index) === 0)].toSorted(
          (one, other) => one - other,
        ),
        waiting: left,
        order: [...order, next],
      };
    },
    {
      ready: dependsOn.flatMap((others, index) => (others.size === 0 ? [index] : [])),
      waiting: new Map(dependsOn.map((others, index) => [index, others.size])),
      order: [],
    },
  );
  return read.order.flatMap(index => sorted.slice(index, index + 1));
};

export const readingOrder = (diff: GraphDiff): ReadingOrder => {
  const parentOf = new Map(diff.nodes.map(node => [node.id, node.parent]));
  const ancestry = (id: string): ReadonlyArray<string> => {
    const parent = parentOf.get(id);
    return parent === undefined ? [id] : [id, ...ancestry(parent)];
  };
  const changed = diff.nodes.filter(node => node.state !== 'unchanged');
  const holdingChanges = new Set(changed.flatMap(node => ancestry(node.id).slice(1)));
  const innermost = changed.filter(node => !holdingChanges.has(node.id));
  const removed = innermost.filter(node => node.state === 'removed').map(node => node.id);
  const parts = innermost.filter(node => node.state !== 'removed').map(node => node.id);
  const targetsOf = new Map(
    [
      ...Map.groupBy(
        diff.edges.filter(edge => edge.state !== 'removed'),
        edge => edge.from,
      ),
    ].map(([from, edges]) => [from, edges.map(edge => edge.to)]),
  );
  const reached = (layers: ReadonlyArray<ReadonlySet<string>>): ReadonlySet<string> => {
    const next = new Set(
      [...(layers.at(-1) ?? [])]
        .flatMap(id => targetsOf.get(id) ?? [])
        .filter(id => !layers.some(layer => layer.has(id))),
    );
    return next.size === 0
      ? new Set(layers.flatMap(layer => [...layer]))
      : reached([...layers, next]);
  };
  const ancestries = new Map(parts.map(part => [part, ancestry(part)]));
  const partsUnder = Map.groupBy(
    parts.flatMap(part => (ancestries.get(part) ?? []).map(id => ({ id, part }))),
    ({ id }) => id,
  );
  const graph: Graph = new Map(
    parts.map(part => {
      const own = ancestries.get(part) ?? [];
      const reach = [...reached([new Set(own)])].filter(id => !own.includes(id));
      return [
        part,
        [...new Set(reach.flatMap(id => (partsUnder.get(id) ?? []).map(under => under.part)))],
      ];
    }),
  );
  const order = dependedUponFirst(stronglyConnected(parts, graph), graph);
  return {
    parts: [...order.flat(), ...removed.toSorted()],
    cycles: order.filter(group => group.length > 1),
  };
};
