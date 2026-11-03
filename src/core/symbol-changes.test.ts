import { expect, test } from 'vitest';
import { symbolsOfTypeScript } from '../readers/typescript/typescript-symbols.ts';
import { symbolChanges, symbolChangesOf } from './symbol-changes.ts';

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

test("an edited function whose decisions changed carries its logic lines, all of them; one whose decisions didn't carries none", () => {
  const before = read(
    'function charge(order) {',
    '  if (!order) return;',
    '  if (order.amount > 0) pay();',
    '}',
    'function refund(order) { if (order.paid) give(1); }',
  );
  const after = read(
    'function charge(order) {',
    '  if (!order) return;',
    '  if (order.amount >= 0) pay();',
    '}',
    'function refund(order) { if (order.paid) give(2); }',
  );

  expect(
    symbolChanges({ before, after }).symbols.map(({ name, logic }) => ({ name, logic })),
  ).toEqual([
    {
      name: 'charge',
      logic: [
        { change: 'same', kind: 'guard', depth: 0, head: 'if (!order) return', line: 2 },
        {
          change: 'changed',
          kind: 'if',
          depth: 0,
          base: 'if (order.amount > 0)',
          head: 'if (order.amount >= 0)',
          line: 3,
        },
      ],
    },
    { name: 'refund', logic: undefined },
  ]);
});

test('a probably renamed function whose decisions changed carries its logic lines', () => {
  const before = read(
    'function charge(order) { if (order.amount > 0) { pay(order); log(order); } }',
  );
  const after = read('function bill(order) { if (order.amount >= 0) { pay(order); log(order); } }');

  expect(symbolChanges({ before, after }).symbols).toEqual([
    expect.objectContaining({
      change: 'renamed',
      probably: true,
      logic: [expect.objectContaining({ change: 'changed', head: 'if (order.amount >= 0)' })],
    }),
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

test('renames pair one to one, equal candidates by name', () => {
  const before = read(
    'function b() { return 1; }',
    'function a() { return 1; }',
    'function h() { return 3; }',
    'function i() { return 3; }',
    'function e() { return 2; }',
  );
  const after = read(
    'function c() { return 1; }',
    'function d() { return 1; }',
    'function k() { return 3; }',
    'function j() { return 3; }',
    'function f() { return 2; }',
    'function g() { return 2; }',
  );

  expect(
    symbolChanges({ before, after }).symbols.map(({ name, change, renamedFrom }) =>
      [name, change, renamedFrom].join(' '),
    ),
  ).toEqual([
    'c renamed a',
    'd renamed b',
    'k renamed i',
    'j renamed h',
    'f renamed e',
    'g added ',
  ]);
});

const nineTerms = 'function charge(a) { return a + 1 + 2 + 3 + 4 + 5 + 6 + 7 + 8 + 9; }';

test.each([
  {
    similar: 'at 0.8',
    base: nineTerms,
    head: 'function bill(a) { return a + 1 + 2 + 3 + 4 + 5 + 6 + 0 + 0; }',
    changes: ['bill renamed charge true'],
  },
  {
    similar: 'just below 0.8',
    base: nineTerms,
    head: 'function bill(a) { return a + 1 + 2 + 3 + 4 + 5 + 6 + 0 + 0 + 0; }',
    changes: ['bill added  ', 'charge removed  '],
  },
  {
    similar: 'counting each repeated pair of tokens',
    base: 'function charge(a) { return a + a + a + a + a + 1; }',
    head: 'function bill(a) { return a + a + a + a + a + 2; }',
    changes: ['bill renamed charge true'],
  },
  {
    similar: 'or surely renamed when equal but for parentheses',
    base: 'const charge = () => (1);',
    head: 'const bill = () => 1;',
    changes: ['bill renamed charge '],
  },
])(
  'a symbol whose body is only similar to a gone one is probably renamed from it, $similar',
  ({ base, head, changes }) => {
    expect(
      symbolChanges({ before: read(base), after: read(head) }).symbols.map(
        ({ name, change, renamedFrom, probably }) =>
          [name, change, renamedFrom, probably].join(' '),
      ),
    ).toEqual(changes);
  },
);

test.each([
  {
    ranked: 'the more similar body first',
    base: [nineTerms],
    head: [
      'function amount(a) { return a + 1 + 2 + 3 + 4 + 5 + 6 + 0 + 0; }',
      'function bill(a) { return a + 1 + 2 + 3 + 4 + 5 + 6 + 7 + 0; }',
    ],
    changes: ['amount added  ', 'bill renamed charge true'],
  },
  {
    ranked: 'an equal body before any similar one',
    base: ['const charge = () => (a + b + c + d + e + f + g + h);'],
    head: [
      'const amp = () => (a + b + c + d + e + f + g + i);',
      'const zed = () => a + b + c + d + e + f + g + h;',
    ],
    changes: ['amp added  ', 'zed renamed charge '],
  },
])('a gone symbol is renamed into its best candidate: $ranked', ({ base, head, changes }) => {
  expect(
    symbolChanges({ before: read(...base), after: read(...head) }).symbols.map(
      ({ name, change, renamedFrom, probably }) => [name, change, renamedFrom, probably].join(' '),
    ),
  ).toEqual(changes);
});

const none = read();

test('a symbol removed from one changed file and added to another with the same kind, name and body moved between them', () => {
  const files = symbolChangesOf([
    { node: 'web/src/shop.ts', before: read('function charge() { return 1; }'), after: none },
    {
      node: 'web/src/till.ts',
      before: none,
      after: read('export function charge() { return 1; }'),
    },
  ]);

  expect(files).toEqual([
    {
      node: 'web/src/shop.ts',
      symbols: [
        {
          name: 'charge',
          kind: 'function',
          exported: { base: false },
          change: 'moved',
          movedTo: 'web/src/till.ts',
        },
      ],
      exports: { added: [], removed: [] },
      kind: 'logic',
    },
    {
      node: 'web/src/till.ts',
      symbols: [
        {
          name: 'charge',
          kind: 'function',
          exported: { head: true },
          change: 'moved',
          movedFrom: 'web/src/shop.ts',
        },
      ],
      exports: { added: ['charge'], removed: [] },
      kind: 'api',
    },
  ]);
});

test.each([
  {
    unlike: 'another name',
    files: [
      { node: 'shop.ts', before: ['function charge() { return 1; }'], after: [] },
      { node: 'till.ts', before: [], after: ['function bill() { return 1; }'] },
    ],
    changes: ['shop.ts charge removed', 'till.ts bill added'],
  },
  {
    unlike: 'another body',
    files: [
      { node: 'shop.ts', before: ['function charge() { return 1; }'], after: [] },
      { node: 'till.ts', before: [], after: ['function charge() { return 2; }'] },
    ],
    changes: ['shop.ts charge removed', 'till.ts charge added'],
  },
  {
    unlike: 'two files it could have come from',
    files: [
      { node: 'shop.ts', before: ['function charge() { return 1; }'], after: [] },
      { node: 'cart.ts', before: ['function charge() { return 1; }'], after: [] },
      { node: 'till.ts', before: [], after: ['function charge() { return 1; }'] },
    ],
    changes: ['shop.ts charge removed', 'cart.ts charge removed', 'till.ts charge added'],
  },
])(
  'a symbol gone from one file and new in another did not move with $unlike',
  ({ files, changes }) => {
    expect(
      symbolChangesOf(
        files.map(({ node, before, after }) => ({
          node,
          before: read(...before),
          after: read(...after),
        })),
      ).flatMap(({ node, symbols }) =>
        symbols.map(({ name, change }) => `${node} ${name} ${change}`),
      ),
    ).toEqual(changes);
  },
);

test("a file's exports are added and removed by name, re-exports included", () => {
  const before = read(
    'export function kept() {}',
    "export * from './cart';",
    'export const old = 1;',
  );
  const after = read('export function kept() {}', 'function old() {}', 'export { old as bill };');

  expect(symbolChanges({ before, after }).exports).toEqual({
    added: ['bill'],
    removed: ['* from ./cart', 'old'],
  });
});

test.each([
  {
    change: 'a comment and spacing only',
    base: ['function charge() { return 1; }'],
    head: ['// charges', 'function charge() {', '  return 1;', '}'],
    kind: 'formatting',
  },
  {
    change: 'an import outside every symbol',
    base: ['function charge() { return 1; }'],
    head: ["import { bill } from './bill';", 'function charge() { return 1; }'],
    kind: 'logic',
  },
  {
    change: 'a symbol no longer exported',
    base: ['export function charge() {}'],
    head: ['function charge() {}'],
    kind: 'api',
  },
  {
    change: "an exported function's signature",
    base: ['export function charge(a: number) {}'],
    head: ['export function charge(a: string) {}'],
    kind: 'api',
  },
  {
    change: "a private function's signature",
    base: ['function charge(a: number) {}'],
    head: ['function charge(a: string) {}'],
    kind: 'logic',
  },
  {
    change: "an exported function's body",
    base: ['export function charge() { return 1; }'],
    head: ['export function charge() { return 2; }'],
    kind: 'logic',
  },
  {
    change: 'a public method added to an exported class',
    base: ['export class Shop {}'],
    head: ['export class Shop { open() {} }'],
    kind: 'api',
  },
  {
    change: 'a public method of an exported class renamed',
    base: ['export class Shop { open() { return 1; } }'],
    head: ['export class Shop { start() { return 1; } }'],
    kind: 'api',
  },
  {
    change: 'a re-export added',
    base: ['export function charge() {}'],
    head: ['export function charge() {}', "export * from './cart';"],
    kind: 'api',
  },
  {
    change: 'a public method removed from an exported class',
    base: ['export class Shop { open() {} }'],
    head: ['export class Shop {}'],
    kind: 'api',
  },
])('$kind: a file with $change changed', ({ base, head, kind }) => {
  expect(symbolChanges({ before: read(...base), after: read(...head) }).kind).toBe(kind);
});
