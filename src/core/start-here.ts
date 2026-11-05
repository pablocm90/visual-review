import { CHECK_TITLES } from './checks.ts';
import type { Finding } from './findings.ts';
import { endsOfId, type GraphNode } from './graph.ts';
import type { NodeMetrics } from './metrics.ts';

type StartHereOptions = {
  readonly findings: ReadonlyArray<Finding>;
  readonly metrics: Readonly<Record<string, NodeMetrics>>;
  readonly nodes: ReadonlyArray<GraphNode>;
};

export type StartHereLine = {
  readonly key: string;
  readonly level: Finding['level'];
  readonly title: string;
  readonly findings: ReadonlyArray<Finding>;
  readonly names: ReadonlyArray<string>;
  readonly files: number;
};

const distinct = (values: ReadonlyArray<string>) => [...new Set(values)];

export const startHere = ({ findings, metrics, nodes }: StartHereOptions) => {
  const nodeOf = new Map(nodes.map(node => [node.id, node]));
  const nodesOf = (group: ReadonlyArray<Finding>) =>
    group.flatMap(({ target }) => [nodeOf.get(target ?? '')].filter(node => node !== undefined));
  const highest = (target: string | undefined, measure: 'fanIn' | 'churn') =>
    target === undefined
      ? Number.POSITIVE_INFINITY
      : Math.max(...endsOfId(target).map(end => metrics[end]?.head?.[measure] ?? 0));
  const isBlindSpot = ({ target, dimension, check }: Finding) =>
    target === undefined &&
    (!(dimension === 'dependencies' || dimension === 'schema') || check.endsWith(':not-read'));
  const ranked = findings.toSorted(
    (one, other) =>
      Number(other.level === 'look') - Number(one.level === 'look') ||
      Number(isBlindSpot(other)) - Number(isBlindSpot(one)) ||
      highest(other.target, 'fanIn') - highest(one.target, 'fanIn') ||
      highest(other.target, 'churn') - highest(one.target, 'churn') ||
      (one.id < other.id ? -1 : 1),
  );
  const keyOf = ({ id, check, level }: Finding) => (check === 'flag' ? id : `${check} ${level}`);
  const lines = [...Map.groupBy(ranked, keyOf)].flatMap(([key, group]) =>
    group.slice(0, 1).map(
      ({ level, check, title }): StartHereLine => ({
        key,
        level,
        title:
          check === 'flag' || group.length === 1 ? title : `${group.length} ${CHECK_TITLES[check]}`,
        findings: group,
        names: distinct(nodesOf(group).map(node => node.label)),
        files: distinct(nodesOf(group).map(node => node.id)).length,
      }),
    ),
  );
  return { lines };
};
