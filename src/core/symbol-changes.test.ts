import { expect, test } from 'vitest';
import { symbolsOfTypeScript } from '../readers/typescript/typescript-symbols.ts';
import { symbolChanges } from './symbol-changes.ts';

const read = (...lines: ReadonlyArray<string>) =>
  symbolsOfTypeScript(lines.join('\n'), 'src/shop.ts');

test('a symbol is paired by scope, name and kind: unchanged with the same text, edited with another, added or removed when on one side only', () => {
  const before = read(
    'export function kept() { return 1; }',
    'function charge() { return 1; }',
    'class Shop { open() { return 1; } }',
  );
  const after = read(
    'export function kept() { return 1; }',
    'function charge() { return 2; }',
    'class Shop {}',
    'export type Id = string;',
  );

  expect(symbolChanges({ before, after }).symbols).toEqual([
    { name: 'kept', kind: 'function', exported: { base: true, head: true }, change: 'unchanged' },
    { name: 'charge', kind: 'function', exported: { base: false, head: false }, change: 'edited' },
    { name: 'Shop', kind: 'class', exported: { base: false, head: false }, change: 'edited' },
    { name: 'Id', kind: 'type', exported: { head: true }, change: 'added' },
    { name: 'open', scope: 'Shop', kind: 'method', exported: { base: false }, change: 'removed' },
  ]);
});

test('a symbol of the same name but another kind or scope is another symbol', () => {
  const before = read('function Order() {}', 'class Shop { open() {} }');
  const after = read('interface Order {}', 'class Shop {}', 'class Till { open() { return 1; } }');

  expect(
    symbolChanges({ before, after }).symbols.map(
      ({ change, kind, scope, name }) => `${change} ${kind} ${scope ?? ''}.${name}`,
    ),
  ).toEqual([
    'added type .Order',
    'edited class .Shop',
    'added class .Till',
    'added method Till.open',
    'removed function .Order',
    'removed method Shop.open',
  ]);
});

test('a symbol whose text changed but not its body or signature only changed formatting', () => {
  const before = read('function charge(amount: number) { return amount; }');
  const after = read(
    'function charge(',
    '  amount: number,',
    ') {',
    '  // as is',
    '  return amount;',
    '}',
  );

  expect(symbolChanges({ before, after }).symbols.map(({ change }) => change)).toEqual([
    'formatting',
  ]);
});

test('a symbol whose signature changed but not its body is edited, as an overload', () => {
  const before = read('function charge(a: number): number;', 'function charge(a: unknown) {}');
  const after = read('function charge(a: string): number;', 'function charge(a: unknown) {}');

  expect(symbolChanges({ before, after }).symbols.map(({ change }) => change)).toEqual(['edited']);
});

test("an edited symbol carries both signatures when its signature changed, and neither when it didn't", () => {
  const before = read(
    'function charge(amount: number) { return 1; }',
    'function refund(amount: number) { return 1; }',
  );
  const after = read(
    'function charge(amount: string) { return 1; }',
    'function refund(amount: number) { return 2; }',
  );

  expect(symbolChanges({ before, after }).symbols).toEqual([
    {
      name: 'charge',
      kind: 'function',
      exported: { base: false, head: false },
      change: 'edited',
      signature: { base: '(amount: number)', head: '(amount: string)' },
    },
    { name: 'refund', kind: 'function', exported: { base: false, head: false }, change: 'edited' },
  ]);
});

test('a symbol gone from the base and new at the head with the same kind and body is renamed', () => {
  const before = read(
    'export function charge(amount: number) { return amount * 2; }',
    'const open = () => 1;',
  );
  const after = read(
    'export function bill(amount: number) { return amount * 2; }',
    'class Shop { static close = () => 1; }',
  );

  expect(symbolChanges({ before, after }).symbols).toEqual([
    {
      name: 'bill',
      kind: 'function',
      exported: { base: true, head: true },
      change: 'renamed',
      renamedFrom: 'charge',
    },
    { name: 'Shop', kind: 'class', exported: { head: false }, change: 'added' },
    { name: 'close', scope: 'Shop', kind: 'method', exported: { head: false }, change: 'added' },
    { name: 'open', kind: 'function', exported: { base: false }, change: 'removed' },
  ]);
});

test("a renamed class's methods are renamed from its former name's, and a function moved in from the top from its bare name", () => {
  const before = read('class Shop { open() { return 1; } }', 'const pick = () => 2;');
  const after = read(
    'class Till { open() { return 1; } }',
    'function load() { const pick = () => 2; }',
  );

  expect(
    symbolChanges({ before, after }).symbols.map(({ name, change, renamedFrom }) => [
      name,
      change,
      renamedFrom,
    ]),
  ).toEqual([
    ['Till', 'renamed', 'Shop'],
    ['open', 'renamed', 'Shop.open'],
    ['load', 'added', undefined],
    ['pick', 'renamed', 'pick'],
  ]);
});

test('a removed symbol with the body of a symbol kept by name is removed, not renamed', () => {
  const before = read('function kept() { return 1; }', 'function twin() { return 1; }');
  const after = read('function kept() { return 1; }');

  expect(
    symbolChanges({ before, after }).symbols.map(({ name, change }) => [name, change]),
  ).toEqual([
    ['kept', 'unchanged'],
    ['twin', 'removed'],
  ]);
});
