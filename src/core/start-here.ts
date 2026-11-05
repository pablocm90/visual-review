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
  readonly dimension: Finding['dimension'];
  readonly title: string;
  readonly findings: ReadonlyArray<Finding>;
  readonly names: ReadonlyArray<string>;
  readonly files: number;
};

const SHOWN = 5;

const FILE_KINDS: ReadonlySet<GraphNode['kind']> = new Set(['file', 'module']);

const distinct = (values: ReadonlyArray<string>) => [...new Set(values)];

export const startHere = ({ findings, metrics, nodes }: StartHereOptions) => {
  const nodeOf = new Map(nodes.map(node => [node.id, node]));
  const nameOf = ({ file, target }: Finding) =>
    file ??
    (target === undefined
      ? []
      : endsOfId(target)
          .map(end => nodeOf.get(end)?.label ?? end)
          .join(' → '));
  const fileOf = ({ file, target }: Finding) => {
    const node = nodeOf.get(target ?? '');
    return file ?? (node && FILE_KINDS.has(node.kind) ? node.id : []);
  };
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
      ({ level, dimension, check, title }): StartHereLine => ({
        key,
        level,
        dimension,
        title:
          check === 'flag' || group.length === 1 ? title : `${group.length} ${CHECK_TITLES[check]}`,
        findings: group,
        names: distinct(group.flatMap(nameOf)),
        files: distinct(group.flatMap(fileOf)).length,
      }),
    ),
  );
  return {
    lines: lines.slice(0, SHOWN),
    look: findings.filter(({ level }) => level === 'look').length,
    total: findings.length,
  };
};
