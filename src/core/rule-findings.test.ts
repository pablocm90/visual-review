import { expect, test } from 'vitest';
import type { GraphEdge } from './graph.ts';
import { ruleFindings } from './rule-findings.ts';

const REASON = 'Controllers reach billing through BillingService.';

const intoBilling: GraphEdge = {
  from: 'shop/class/UsersController',
  to: 'shop/class/Billing::Invoice',
};

const breaking = (edge: GraphEdge) => ({
  rule: 'controllers-skip-billing',
  reason: REASON,
  edge,
});

test('an edge the change adds across a rule is a rules finding to look at on the edge, named by the rule and saying its reason', () => {
  expect(
    ruleFindings({
      ruleBreaks: [breaking(intoBilling)],
      edges: [{ ...intoBilling, state: 'added' }],
    }),
  ).toStrictEqual([
    {
      id: 'rules:broken:controllers-skip-billing:shop/class/UsersController -> shop/class/Billing::Invoice',
      check: 'rules:broken',
      dimension: 'rules',
      level: 'look',
      target: 'shop/class/UsersController -> shop/class/Billing::Invoice',
      title: 'breaks controllers-skip-billing',
      detail: REASON,
    },
  ]);
});

test('an edge already there before the change breaking a rule is for information', () => {
  expect(
    ruleFindings({
      ruleBreaks: [breaking(intoBilling)],
      edges: [{ ...intoBilling, state: 'unchanged' }],
    }).map(({ level }) => level),
  ).toStrictEqual(['info']);
});

test("a call edge's finding says the paths it calls through after the reason", () => {
  const call = { from: 'web/file/a.ts', to: 'api', via: ['/api/invoices', '/api/refunds'] };

  expect(
    ruleFindings({
      ruleBreaks: [breaking(call)],
      edges: [{ ...call, state: 'added' }],
    }).map(({ detail }) => detail),
  ).toStrictEqual([`${REASON} (via /api/invoices, /api/refunds)`]);
});
