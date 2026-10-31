import { expect, test } from 'vitest';
import type { DiffedNode } from './diff-graphs.ts';
import { measuredLeaves } from './metric-rows.ts';
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
