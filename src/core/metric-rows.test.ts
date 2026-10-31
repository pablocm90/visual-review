import { expect, test } from 'vitest';
import type { DiffedNode } from './diff-graphs.ts';
import { type MeasuredLeaf, measuredLeaves, sortedLeaves } from './metric-rows.ts';
import type { NodeMeasures } from './metrics.ts';

const node = (id: string, state: DiffedNode['state'], parent?: string): DiffedNode => ({
  id,
  kind: parent === undefined ? 'stack' : 'module',
  label: id,
  path: id,
  state,
  ...(parent !== undefined && { parent }),
});

const measures: NodeMeasures = { churn: 1, fanIn: 0, fanOut: 0 };

test('the measured leaves are the nodes with metrics that are no box, in the diff order, each with its stack', () => {
  const nodes = [
    node('api', 'modified'),
    node('api/orders', 'modified', 'api'),
    node('api/orders/refund', 'modified', 'api/orders'),
    node('api/orders/ledger', 'added', 'api/orders'),
    node('web', 'unchanged'),
    node('web/cart', 'unchanged', 'web'),
    node('web/checkout', 'removed', 'web'),
  ];

  const leaves = measuredLeaves({
    diff: { nodes, edges: [] },
    metrics: {
      api: { highestInside: true, head: measures },
      'api/orders': { highestInside: true, head: measures },
      'api/orders/refund': { base: measures, head: measures },
      'web/cart': { base: measures, head: measures },
      'web/checkout': { base: measures },
    },
  });

  expect(leaves.map(({ node, stack }) => [node.id, stack])).toEqual([
    ['api/orders/refund', 'api'],
    ['web/cart', 'web'],
    ['web/checkout', 'web'],
  ]);
  expect(leaves[2]).toEqual({ node: nodes[6], stack: 'web', base: measures });
});

const complex = ({
  cyclomatic,
  lines,
  abc,
  churn = 1,
  total = cyclomatic,
}: {
  readonly cyclomatic: number;
  readonly total?: number;
  readonly lines: number;
  readonly abc: number;
  readonly churn?: number;
}): NodeMeasures => ({
  churn,
  fanIn: 0,
  fanOut: 0,
  lines,
  functions: 1,
  cyclomatic: { highest: cyclomatic, total },
  abc,
});

const leaf = (id: string, sides: Pick<MeasuredLeaf, 'base' | 'head'>): MeasuredLeaf => ({
  node: node(id, 'modified', 'api'),
  stack: 'api',
  ...sides,
});

const leaves = [
  leaf('retry', { base: complex({ cyclomatic: 6, lines: 88, abc: 20, churn: 5 }) }),
  leaf('domain', { base: { ...measures, churn: 12 }, head: { ...measures, churn: 12 } }),
  leaf('cart', { base: { ...measures, churn: 2 }, head: { ...measures, churn: 2 } }),
  leaf('ledger', { head: complex({ cyclomatic: 3, lines: 96, abc: 10 }) }),
  leaf('stripe', {
    base: complex({ cyclomatic: 2, lines: 40, abc: 6 }),
    head: complex({ cyclomatic: 5, lines: 52, abc: 8, churn: 4 }),
  }),
  leaf('refund', {
    base: complex({ cyclomatic: 4, total: 30, lines: 120, abc: 18 }),
    head: complex({ cyclomatic: 14, total: 30, lines: 184, abc: 31.5, churn: 9 }),
  }),
];

test('sorted by cyclomatic Δ, the leaves go highest first, a missing side or complexity counting 0 and ties keeping their order', () => {
  expect(sortedLeaves({ leaves, by: 'cyclomatic' }).map(({ node }) => node.id)).toEqual([
    'refund',
    'ledger',
    'stripe',
    'domain',
    'cart',
    'retry',
  ]);
});
