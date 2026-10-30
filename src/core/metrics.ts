import type { GraphDiff } from './diff-graphs.ts';
import type { Graph, GraphEdge } from './graph.ts';
import type { Churn, Measures, RangeReading } from './read-range.ts';
import type { FileMeasures } from './reader.ts';

type Complexity = {
  readonly lines: number;
  readonly functions: number;
  readonly cyclomatic: { readonly highest: number; readonly total: number };
  readonly abc: number;
};

type Fan = { readonly fanIn: number; readonly fanOut: number };

export type NodeMeasures = { readonly churn: number } & (Fan | Record<never, never>) &
  (Complexity | Record<never, never>);

export type NodeMetrics = {
  readonly highestInside?: true;
  readonly base?: NodeMeasures;
  readonly head?: NodeMeasures;
};

type NodeMetricsOptions = {
  readonly diff: GraphDiff;
  readonly before: Graph;
  readonly churn: RangeReading['churn'];
  readonly measures: RangeReading['measures'];
};

const sum = (values: ReadonlyArray<number>): number => values.reduce((a, b) => a + b, 0);

const complexityOf = ({ lines, functions }: FileMeasures): Complexity => {
  const cyclomatics = functions.map(({ cyclomatic }) => cyclomatic);
  const parts = [
    sum(functions.map(({ abc }) => abc.assignments)),
    sum(functions.map(({ abc }) => abc.branches)),
    sum(functions.map(({ abc }) => abc.conditions)),
  ];
  return {
    lines,
    functions: functions.length,
    cyclomatic: { highest: Math.max(0, ...cyclomatics), total: sum(cyclomatics) },
    abc: Math.round(Math.hypot(...parts) * 10) / 10,
  };
};

type MeasuresAtOptions = {
  readonly churn: Churn;
  readonly measures: Measures;
  readonly edges: ReadonlyArray<GraphEdge>;
  readonly id: string;
  readonly path: string | undefined;
};

const measuresAt = ({
  churn,
  measures,
  edges,
  id,
  path,
}: MeasuresAtOptions): NodeMeasures | undefined => {
  if (path === undefined) return undefined;
  const commits = churn[path];
  if (commits === undefined) return undefined;
  const file = measures[path];
  return {
    churn: commits,
    fanIn: edges.filter(({ to }) => to === id).length,
    fanOut: edges.filter(({ from }) => from === id).length,
    ...(file && complexityOf(file)),
  };
};

const sides = (base: NodeMeasures | undefined, head: NodeMeasures | undefined): NodeMetrics => ({
  ...(base && { base }),
  ...(head && { head }),
});

const highest = (measures: ReadonlyArray<NodeMeasures | undefined>): NodeMeasures | undefined => {
  const churns = measures.flatMap(each => (each === undefined ? [] : [each.churn]));
  return churns.length === 0 ? undefined : { churn: Math.max(...churns) };
};

export type MeasuredNode = {
  readonly id: string;
  readonly basePath: string | undefined;
  readonly headPath: string;
};

type MeasuredNodesOptions = {
  readonly diff: GraphDiff;
  readonly before: Graph;
};

export const measuredNodes = ({
  diff,
  before,
}: MeasuredNodesOptions): ReadonlyArray<MeasuredNode> => {
  const changed = new Set(
    diff.nodes.filter(node => node.state !== 'unchanged').map(node => node.id),
  );
  const measured = new Set([
    ...changed,
    ...diff.edges
      .filter(({ from, to }) => changed.has(from) || changed.has(to))
      .flatMap(({ from, to }) => [from, to]),
  ]);
  const basePath = new Map(before.nodes.map(({ id, path }) => [id, path]));
  return diff.nodes
    .filter(node => measured.has(node.id))
    .map(node => ({
      id: node.id,
      basePath: node.renamedFrom ?? basePath.get(node.id),
      headPath: node.path,
    }));
};

export const nodeMetrics = ({
  diff,
  before,
  churn,
  measures,
}: NodeMetricsOptions): Readonly<Record<string, NodeMetrics>> => {
  const baseSide = {
    churn: churn.before,
    measures: measures.before,
    edges: diff.edges.filter(({ state }) => state !== 'added'),
  };
  const headSide = {
    churn: churn.after,
    measures: measures.after,
    edges: diff.edges.filter(({ state }) => state !== 'removed'),
  };
  const leaves: Readonly<Record<string, NodeMetrics>> = Object.fromEntries(
    measuredNodes({ diff, before }).flatMap(({ id, basePath, headPath }) => {
      const base = measuresAt({ ...baseSide, id, path: basePath });
      const head = measuresAt({ ...headSide, id, path: headPath });
      if (base === undefined && head === undefined) return [];
      return [[id, sides(base, head)]];
    }),
  );
  const parentOf = new Map(diff.nodes.map(({ id, parent }) => [id, parent]));
  const isInside = (id: string, box: string): boolean => {
    const parent = parentOf.get(id);
    return parent !== undefined && (parent === box || isInside(parent, box));
  };
  const boxes = diff.nodes.flatMap(node => {
    const inside = Object.entries(leaves)
      .filter(([id]) => isInside(id, node.id))
      .map(([, metrics]) => metrics);
    if (inside.length === 0) return [];
    const base = highest(inside.map(metrics => metrics.base));
    const head = highest(inside.map(metrics => metrics.head));
    return [[node.id, { highestInside: true, ...sides(base, head) }]];
  });
  return { ...leaves, ...Object.fromEntries(boxes) };
};
