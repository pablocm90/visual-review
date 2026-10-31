import { expect, test } from 'vitest';
import type { DiffedNode, GraphDiff } from './diff-graphs.ts';
import { hotspotMoves } from './hotspot-moves.ts';
import type { NodeMeasures, NodeMetrics } from './metrics.ts';

const leaf = (name: string, state: DiffedNode['state']): DiffedNode => ({
  id: `api/module/${name}`,
  kind: 'module',
  label: name,
  parent: 'api',
  path: `crates/api/src/${name}.rs`,
  state,
});

const measured = (churn: number, cyclomatic: number): NodeMeasures => ({
  churn,
  fanIn: 0,
  fanOut: 0,
  lines: 10,
  functions: 1,
  cyclomatic: { highest: cyclomatic, total: cyclomatic },
  abc: 1,
});

const unmeasured: NodeMeasures = { churn: 2, fanIn: 0, fanOut: 0 };

const thresholds = { cyclomatic: 10, hotspot: { churn: 6, cyclomatic: 8 } };

const reviewOf = (rows: ReadonlyArray<readonly [DiffedNode, NodeMetrics]>) => {
  const metrics: Readonly<Record<string, NodeMetrics>> = {
    api: { highestInside: true, base: measured(9, 9), head: measured(9, 12) },
    ...Object.fromEntries(rows.map(([node, metrics]) => [node.id, metrics])),
  };
  const diff: GraphDiff = {
    nodes: [
      { id: 'api', kind: 'stack', label: 'api', path: '', state: 'modified' },
      ...rows.map(([node]) => node),
    ],
    edges: [],
  };
  return { diff, metrics, thresholds };
};

const pointsOf = (moves: ReturnType<typeof hotspotMoves>) =>
  moves.map(({ node, base, head }) => [node.label, base, head]);

test("each changed leaf with complexity on its head moves from its base's churn and highest cyclomatic, when the base has them, to its head's; removed and unchanged leaves, boxes and heads without complexity are left out", () => {
  const moves = hotspotMoves(
    reviewOf([
      [leaf('refund', 'modified'), { base: measured(6, 4), head: measured(9, 14) }],
      [leaf('ledger', 'added'), { head: measured(1, 5) }],
      [leaf('stripe', 'modified'), { base: unmeasured, head: measured(7, 9) }],
      [leaf('retry', 'removed'), { base: measured(2, 5) }],
      [leaf('routes', 'unchanged'), { base: measured(3, 3), head: measured(4, 4) }],
      [leaf('schema', 'modified'), { base: measured(3, 3), head: unmeasured }],
    ]),
  );

  expect(pointsOf(moves)).toEqual([
    ['refund', { churn: 6, cyclomatic: 4 }, { churn: 9, cyclomatic: 14 }],
    ['ledger', undefined, { churn: 1, cyclomatic: 5 }],
    ['stripe', undefined, { churn: 7, cyclomatic: 9 }],
  ]);
});
