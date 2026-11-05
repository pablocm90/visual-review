import { CHECK_TITLES } from './checks.ts';
import type { Finding } from './findings.ts';
import type { GraphNode } from './graph.ts';
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

export const startHere = ({ findings, nodes }: StartHereOptions) => {
  const nodeOf = new Map(nodes.map(node => [node.id, node]));
  const nodesOf = (group: ReadonlyArray<Finding>) =>
    group.flatMap(({ target }) => [nodeOf.get(target ?? '')].filter(node => node !== undefined));
  const ranked = findings.toSorted(
    (one, other) => Number(other.level === 'look') - Number(one.level === 'look'),
  );
  const lines = [...Map.groupBy(ranked, ({ check, level }) => `${check} ${level}`)].flatMap(
    ([key, group]) =>
      group.slice(0, 1).map(
        ({ level, check }): StartHereLine => ({
          key,
          level,
          title: check === 'flag' ? '' : `${group.length} ${CHECK_TITLES[check]}`,
          findings: group,
          names: distinct(nodesOf(group).map(node => node.label)),
          files: distinct(nodesOf(group).map(node => node.id)).length,
        }),
      ),
  );
  return { lines };
};
