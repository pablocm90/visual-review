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
