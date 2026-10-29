import { edgeId, type Graph, type GraphEdge, type GraphNode } from './graph.ts';

export type FilePatch = {
  readonly path: string;
  readonly patch: string;
};

export type Rename = {
  readonly from: string;
  readonly to: string;
};

type Diffed<T, KeptState> = T & { readonly state: 'added' | 'removed' | KeptState };

export type GraphDiff = {
  readonly nodes: ReadonlyArray<
    Diffed<GraphNode, 'modified' | 'unchanged'> & {
      readonly renamedFrom?: string;
      readonly formerLabel?: string;
    }
  >;
  readonly edges: ReadonlyArray<Diffed<GraphEdge, 'unchanged'>>;
};

type DiffGraphsOptions = {
  readonly before: Graph;
  readonly after: Graph;
  readonly changedPaths: ReadonlyArray<string>;
  readonly renames: ReadonlyArray<Rename>;
};

type DiffItemsOptions<T, KeptState> = {
  readonly before: ReadonlyArray<T>;
  readonly after: ReadonlyArray<T>;
  readonly keyOf: (item: T) => string;
  readonly stateOfKept: (item: T) => KeptState;
};

const diffItems = <T, KeptState extends string>({
  before,
  after,
  keyOf,
  stateOfKept,
}: DiffItemsOptions<T, KeptState>): ReadonlyArray<Diffed<T, KeptState>> => {
  const beforeKeys = new Set(before.map(keyOf));
  const afterKeys = new Set(after.map(keyOf));
  return [
    ...after.map(
      (item): Diffed<T, KeptState> => ({
        ...item,
        state: beforeKeys.has(keyOf(item)) ? stateOfKept(item) : 'added',
      }),
    ),
    ...before
      .filter(item => !afterKeys.has(keyOf(item)))
      .map((item): Diffed<T, KeptState> => ({ ...item, state: 'removed' })),
  ];
};

export const isAtOrUnder = (path: string, node: GraphNode): boolean =>
  path === node.path || path.startsWith(`${node.path}/`);

type PairNodesOptions = {
  readonly before: Graph;
  readonly after: Graph;
  readonly renames: ReadonlyArray<Rename>;
};

const pairNodes = ({
  before,
  after,
  renames,
}: PairNodesOptions): ReadonlyMap<string, { from: GraphNode; to: GraphNode }> => {
  const beforeIds = new Set(before.nodes.map(node => node.id));
  const afterIds = new Set(after.nodes.map(node => node.id));
  const added = after.nodes.filter(node => !beforeIds.has(node.id));
  const filesAcross = (from: GraphNode, to: GraphNode): number => {
    if (from.kind !== to.kind || from.path === '') return 0;
    if (from.path === to.path) return Number.POSITIVE_INFINITY;
    return renames.filter(rename => isAtOrUnder(rename.from, from) && isAtOrUnder(rename.to, to))
      .length;
  };
  return new Map(
    before.nodes
      .filter(node => !afterIds.has(node.id))
      .flatMap(from => {
        const [best] = added
          .map(to => ({ to, files: filesAcross(from, to) }))
          .filter(({ files }) => files > 0)
          .sort((a, b) => b.files - a.files);
        return best === undefined ? [] : [[from.id, { from, to: best.to }] as const];
      }),
  );
};

export const diffGraphs = ({
  before,
  after,
  changedPaths,
  renames,
}: DiffGraphsOptions): GraphDiff => {
  const isTouched = (node: GraphNode): boolean =>
    changedPaths.some(path => isAtOrUnder(path, node));
  const pairs = pairNodes({ before, after, renames });
  const pairedFrom = new Map([...pairs].map(([, { from, to }]) => [to.id, from]));
  const renamedFrom = new Map(renames.map(({ from, to }) => [to, from]));
  const idOf = (id: string): string => pairs.get(id)?.to.id ?? id;
  return {
    nodes: diffItems({
      before: before.nodes.map(node => ({ ...node, id: idOf(node.id) })),
      after: after.nodes,
      keyOf: node => node.id,
      stateOfKept: node => (isTouched(node) ? 'modified' : 'unchanged'),
    }).map(node => {
      const former = pairedFrom.get(node.id);
      const from = former === undefined ? renamedFrom.get(node.path) : former.path;
      return {
        ...node,
        ...(from === undefined || from === node.path ? {} : { renamedFrom: from }),
        ...(former === undefined || former.label === node.label
          ? {}
          : { formerLabel: former.label }),
      };
    }),
    edges: diffItems({
      before: before.edges.map(edge => ({ ...edge, from: idOf(edge.from), to: idOf(edge.to) })),
      after: after.edges,
      keyOf: edgeId,
      stateOfKept: () => 'unchanged',
    }),
  };
};

export type DiffedNode = GraphDiff['nodes'][number];

export type DiffedEdge = GraphDiff['edges'][number];
