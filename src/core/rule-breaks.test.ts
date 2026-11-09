import { expect, test } from 'vitest';
import type { Graph, GraphNode } from './graph.ts';
import { ruleBreaks, rulesNotRead } from './rule-breaks.ts';

const shopClass = (constant: string, layer: string): GraphNode => ({
  id: `shop/class/${constant}`,
  kind: 'file',
  label: constant,
  parent: `shop/layer/${layer}`,
  path: `shop/app/${layer}/${constant}.rb`,
});

const layer = (name: string): GraphNode => ({
  id: `shop/layer/${name}`,
  kind: 'module',
  label: name,
  parent: 'shop',
  path: `shop/app/${name}`,
});

const graphOf = (edges: Graph['edges']): Graph => ({
  nodes: [
    { id: 'shop', kind: 'stack', label: 'shop', path: '' },
    layer('controllers'),
    layer('models'),
    layer('services'),
    shopClass('OrdersController', 'controllers'),
    shopClass('Invoice', 'models'),
    shopClass('Order', 'models'),
    shopClass('BillingService', 'services'),
  ],
  edges,
});

const rule = {
  from: ['shop/class/*Controller'],
  notTo: ['shop/class/Invoice'],
  reason: 'Controllers reach invoices through BillingService.',
};

test('an edge from a node a rule holds for to one it may not depend on breaks the rule, by name and reason; others break nothing', () => {
  const breaking = { from: 'shop/class/OrdersController', to: 'shop/class/Invoice' };
  const graph = graphOf([
    breaking,
    { from: 'shop/class/OrdersController', to: 'shop/class/Order' },
    { from: 'shop/class/BillingService', to: 'shop/class/Invoice' },
  ]);

  expect(ruleBreaks({ rules: { 'no-invoices': rule }, graph })).toStrictEqual([
    { rule: 'no-invoices', reason: rule.reason, edge: breaking },
  ]);
});

test('a node matches a rule by any node above it, and by any of its globs', () => {
  const edges = [
    { from: 'shop/class/OrdersController', to: 'shop/class/Invoice' },
    { from: 'shop/class/OrdersController', to: 'shop/class/BillingService' },
  ];
  const layered = {
    from: ['shop/layer/controllers'],
    notTo: ['shop/class/Missing', 'shop/layer/models'],
    reason: 'Controllers go through services.',
  };

  const broken = ruleBreaks({ rules: { layered }, graph: graphOf(edges) });

  expect(broken.map(({ edge }) => edge)).toStrictEqual([edges[0]]);
});

test('an edge inside the area a rule forbids breaks nothing, though its start is a node the rule holds for', () => {
  const edges = [
    { from: 'shop/class/Order', to: 'shop/class/Invoice' },
    { from: 'shop/class/BillingService', to: 'shop/class/Invoice' },
  ];
  const fenced = { from: ['shop/**'], notTo: ['shop/layer/models'], reason: 'Models stand apart.' };

  const broken = ruleBreaks({ rules: { fenced }, graph: graphOf(edges) });

  expect(broken.map(({ edge }) => edge)).toStrictEqual([edges[1]]);
});

test('with no rules configured, the rules are not read', () => {
  expect(rulesNotRead({ rules: {}, graph: graphOf([]) })).toStrictEqual(['none configured']);
});

test.for([
  {
    side: 'from',
    rule: { ...rule, from: ['shop/class/*Controller', 'shop/class/*Controler'] },
    line: 'no-invoices: from shop/class/*Controler matches no node',
  },
  {
    side: 'notTo',
    rule: { ...rule, notTo: ['shop/class/Invoce', 'shop/layer/models'] },
    line: 'no-invoices: notTo shop/class/Invoce matches no node',
  },
])("a rule's $side glob matching no node is read as not read, naming it", ({ rule, line }) => {
  expect(rulesNotRead({ rules: { 'no-invoices': rule }, graph: graphOf([]) })).toStrictEqual([
    line,
  ]);
});
