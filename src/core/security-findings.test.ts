import { expect, test } from 'vitest';
import type { SymbolFile } from './read-range.ts';
import type { Risk } from './reader.ts';
import { riskFindings } from './security-findings.ts';
import type { SymbolStatement } from './symbol-changes.ts';

const NODE = 'shop/class/UsersController';

const create = (risks: ReadonlyArray<Risk>): SymbolStatement => ({
  name: 'create',
  scope: 'UsersController',
  kind: 'method',
  lines: { base: { start: 2, end: 4 }, head: { start: 2, end: 5 } },
  exported: { base: true, head: true },
  change: 'edited',
  risks,
});

const file = (...symbols: ReadonlyArray<SymbolStatement>): SymbolFile => ({
  stack: 'shop',
  node: NODE,
  symbols,
  exports: { added: [], removed: [] },
  kind: 'logic',
});

test('a key a method gains to permit needs a look, on its file, found by name', () => {
  expect(riskFindings([file(create([{ kind: 'permit', text: 'admin' }]))])).toStrictEqual([
    {
      id: `security:permit:${NODE}#UsersController.create`,
      check: 'security:permit',
      dimension: 'security',
      level: 'look',
      target: NODE,
      title: 'method UsersController.create permits admin',
      detail: 'found by name',
    },
  ]);
});

test.for([
  {
    risk: { kind: 'permit!', text: 'params.permit!' },
    title: 'method UsersController.create permits every parameter',
    detail: 'params.permit! (found by name)',
  },
  {
    risk: { kind: 'raw-sql', text: 'User.where("a = #{a}")', detail: 'interpolated' },
    title: 'method UsersController.create runs raw SQL',
    detail: 'User.where("a = #{a}") (found by name, interpolated)',
  },
  {
    risk: { kind: 'html-safe', text: 'name.html_safe' },
    title: 'method UsersController.create marks HTML safe',
    detail: 'name.html_safe (found by name)',
  },
  {
    risk: { kind: 'dynamic-send', text: 'user.send(field)' },
    title: 'method UsersController.create sends a name it does not write',
    detail: 'user.send(field) (found by name)',
  },
] as const)(
  'a gained $risk.kind call needs a look under its own check',
  ({ risk, title, detail }) => {
    expect(riskFindings([file(create([risk]))])).toStrictEqual([
      {
        id: `security:${risk.kind}:${NODE}#UsersController.create`,
        check: `security:${risk.kind}`,
        dimension: 'security',
        level: 'look',
        target: NODE,
        title,
        detail,
      },
    ]);
  },
);
