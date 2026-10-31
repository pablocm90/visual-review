import { expect, test } from 'vitest';
import type { DiffedNode, GraphDiff } from './diff-graphs.ts';
import { metricTotals } from './metric-totals.ts';
import type { NodeMeasures, NodeMetrics } from './metrics.ts';

const leaf = (name: string, state: DiffedNode['state']): DiffedNode => ({
  id: `api/module/${name}`,
  kind: 'module',
  label: name,
  parent: 'api',
  path: `crates/api/src/${name}.rs`,
  state,
});

const measured = (
  lines: number,
  functions: ReadonlyArray<readonly [string, number]> = [],
  churn = 1,
): NodeMeasures => ({
  churn,
  fanIn: 0,
  fanOut: 0,
  lines,
  functions: functions.length,
  cyclomatic: {
    highest: Math.max(0, ...functions.map(([, cyclomatic]) => cyclomatic)),
    total: functions.reduce((sum, [, cyclomatic]) => sum + cyclomatic, 0),
    byFunction: functions.map(([name, cyclomatic]) => ({ name, cyclomatic })),
  },
  abc: 1,
});

const unmeasured: NodeMeasures = { churn: 2, fanIn: 0, fanOut: 0 };

const reviewOf = (
  rows: ReadonlyArray<readonly [DiffedNode, NodeMetrics]>,
): { readonly diff: GraphDiff; readonly metrics: Readonly<Record<string, NodeMetrics>> } => ({
  diff: {
    nodes: [
      { id: 'api', kind: 'stack', label: 'api', path: '', state: 'modified' },
      ...rows.map(([node]) => node),
    ],
    edges: [],
  },
  metrics: {
    api: { highestInside: true, base: measured(500), head: measured(900) },
    ...Object.fromEntries(rows.map(([node, metrics]) => [node.id, metrics])),
  },
});

const thresholds = { cyclomatic: 10, hotspot: { churn: 6, cyclomatic: 8 } };

test("the lines total sums the changed leaves' head − base lines, a missing side as none, across the changed leaves with lines on a side; unchanged leaves, boxes and leaves without complexity count for nothing", () => {
  const totals = metricTotals({
    ...reviewOf([
      [leaf('refund', 'modified'), { base: measured(120), head: measured(184) }],
      [leaf('ledger', 'added'), { head: measured(96) }],
      [leaf('retry', 'removed'), { base: measured(88) }],
      [leaf('routes', 'unchanged'), { base: measured(64), head: measured(71) }],
      [leaf('rails', 'modified'), { base: unmeasured, head: unmeasured }],
    ]),
    thresholds,
  });

  expect(totals.lines).toEqual({ by: 72, across: 3 });
});

test("the functions over the cyclomatic threshold are counted on each side over the changed leaves, one at the threshold not over, naming the head's highest function; with no head function, none is named", () => {
  const totals = metricTotals({
    ...reviewOf([
      [
        leaf('refund', 'modified'),
        {
          base: measured(1, [
            ['refund_order', 4],
            ['settle', 11],
          ]),
          head: measured(1, [
            ['refund_order', 14],
            ['settle', 11],
            ['split', 10],
          ]),
        },
      ],
      [leaf('ledger', 'added'), { head: measured(1, [['post', 12]]) }],
      [leaf('retry', 'removed'), { base: measured(1, [['retry', 15]]) }],
      [
        leaf('routes', 'unchanged'),
        { base: measured(1, [['route', 20]]), head: measured(1, [['route', 20]]) },
      ],
    ]),
    thresholds,
  });

  expect(totals.over).toEqual({
    base: 2,
    head: 3,
    highest: { name: 'refund_order', cyclomatic: 14 },
  });
  expect(
    metricTotals({
      ...reviewOf([[leaf('retry', 'removed'), { base: measured(1, [['retry', 15]]) }]]),
      thresholds,
    }).over,
  ).toStrictEqual({ base: 1, head: 0 });
});
