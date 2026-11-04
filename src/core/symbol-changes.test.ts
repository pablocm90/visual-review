import { expect, test } from 'vitest';
import { symbolsOfTypeScript } from '../readers/typescript/typescript-symbols.ts';
import { type FileSymbolChanges, symbolChanges, symbolChangesOf } from './symbol-changes.ts';

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

const accessorChanges = (...head: ReadonlyArray<string>) =>
  symbolChanges({
    before: read(
      'export class O {',
      '  get value() { if (!a) return 1; return 2; }',
      '  set value(v) { z(v); }',
      '}',
    ),
    after: read('export class O {', ...head, '}'),
  }).symbols.flatMap(({ kind, name, change, exported, signature, logic }) =>
    name === 'value' ? [{ kind, change, exported, signature, logic }] : [],
  );

test("a getter and its setter each read against their own side, so neither takes on the other's signature or logic", () => {
  expect(
    accessorChanges('  get value() { if (!a) return 1; return 2; }', '  set value(v) { z(v); }'),
  ).toStrictEqual([
    {
      kind: 'getter',
      change: 'unchanged',
      exported: { base: true, head: true },
      signature: undefined,
      logic: undefined,
    },
    {
      kind: 'setter',
      change: 'unchanged',
      exported: { base: true, head: true },
      signature: undefined,
      logic: undefined,
    },
  ]);
});

test("an edited setter's logic lines read against the base's setter, not its getter", () => {
  const [getter, setter] = accessorChanges(
    '  get value() { if (!a) return 1; return 2; }',
    '  set value(v) { if (!v) return; z(v); }',
  );

  expect(getter?.change).toBe('unchanged');
  expect(setter?.logic?.map(({ change, head }) => ({ change, head }))).toStrictEqual([
    { change: 'added', head: 'if (!v) return' },
  ]);
});

test('removing a getter reports the getter removed and leaves its setter unchanged', () => {
  expect(
    accessorChanges('  set value(v) { z(v); }').map(({ kind, change }) => ({ kind, change })),
  ).toStrictEqual([
    { kind: 'setter', change: 'unchanged' },
    { kind: 'getter', change: 'removed' },
  ]);
});

const changesOfFoo = (base: string, head: string) =>
  symbolChanges({
    before: read('class A {', base, '}'),
    after: read('class A {', head, '}'),
  }).symbols.flatMap(({ kind, name, change, logic }) =>
    name === 'A' ? [] : [{ kind, name, change, logic: logic?.map(({ change }) => change) }],
  );

test('a method turned into a getter keeps its pair, so the logic it lost still shows', () => {
  expect(
    changesOfFoo(
      '  foo() { if (!this.v) return 0; return this.v; }',
      '  get foo() { return this.v; }',
    ),
  ).toStrictEqual([{ kind: 'getter', name: 'foo', change: 'edited', logic: ['removed'] }]);
});

test('an accessor turned into a method keeps its pair, and a second accessor of that name has none left', () => {
  expect(
    changesOfFoo(
      '  get foo() { return 1; }\n  set foo(v) { z(v); }',
      '  foo() { if (!this.v) return 0; return 1; }',
    ),
  ).toStrictEqual([
    { kind: 'method', name: 'foo', change: 'edited', logic: ['added'] },
    { kind: 'setter', name: 'foo', change: 'removed', logic: undefined },
  ]);
});

test('a method split into a getter and a setter pairs with the first, the other being new', () => {
  expect(
    changesOfFoo('  foo() { return 1; }', '  get foo() { return 2; }\n  set foo(v) { z(v); }'),
  ).toStrictEqual([
    { kind: 'getter', name: 'foo', change: 'edited', logic: undefined },
    { kind: 'setter', name: 'foo', change: 'added', logic: undefined },
  ]);
});

test('a getter replaced by a setter of that name is no pair: they are different doors', () => {
  expect(changesOfFoo('  get foo() { return 1; }', '  set foo(v) { z(v); }')).toStrictEqual([
    { kind: 'setter', name: 'foo', change: 'added', logic: undefined },
    { kind: 'getter', name: 'foo', change: 'removed', logic: undefined },
  ]);
});

test('a method turned into a setter keeps its pair too', () => {
  expect(
    changesOfFoo('  foo(v) { if (!v) return; z(v); }', '  set foo(v) { z(v); }'),
  ).toStrictEqual([{ kind: 'setter', name: 'foo', change: 'edited', logic: ['removed'] }]);
});

test('a method gone and an unlike getter of another name are no pair', () => {
  expect(
    changesOfFoo('  foo() { return one(1); }', '  get bar() { z(2, 3); return four; }'),
  ).toStrictEqual([
    { kind: 'getter', name: 'bar', change: 'added', logic: undefined },
    { kind: 'method', name: 'foo', change: 'removed', logic: undefined },
  ]);
});

test('a method renamed and turned into a getter is still a rename', () => {
  const body = 'return this.items.filter(item => item.open).map(item => item.total);';
  expect(changesOfFoo(`  foo() { ${body} }`, `  get bar() { ${body} }`)).toStrictEqual([
    { kind: 'getter', name: 'bar', change: 'renamed', logic: undefined },
  ]);
});

test('a getter renamed to an equal-bodied setter is no rename', () => {
  const body = 'this.items.filter(item => item.open).map(item => item.total);';
  expect(changesOfFoo(`  get foo() { ${body} }`, `  set bar(v) { ${body} }`)).toStrictEqual([
    { kind: 'setter', name: 'bar', change: 'added', logic: undefined },
    { kind: 'getter', name: 'foo', change: 'removed', logic: undefined },
  ]);
});

const logicOfIn = (files: ReadonlyArray<FileSymbolChanges>, name: string) =>
  files.flatMap(file => file.symbols).find(symbol => symbol.name === name)?.logic;

test('a decision a function lost and a new function of the same file gained moved there', () => {
  const [before, after] = [
    read('function ReviewPage(open) {', '  if (!open) return;', '  draw();', '}'),
    read(
      'function ReviewPage(open) { return Page(open); }',
      'function Page(open) {',
      '  if (!open) return;',
      '  draw();',
      '}',
    ),
  ];

  expect(logicOfIn(symbolChangesOf([{ node: 'a', before, after }]), 'ReviewPage')).toEqual([
    {
      change: 'moved',
      kind: 'guard',
      depth: 0,
      base: 'if (!open) return',
      line: 2,
      movedTo: 'Page',
    },
  ]);
});

test('a decision lost to a new function in another changed file moved there too', () => {
  const files = symbolChangesOf([
    {
      node: 'a',
      before: read('function charge(order) { if (order == null) return; pay(); }'),
      after: read('function charge(order) { pay(); }'),
    },
    {
      node: 'b',
      before: none,
      after: read('class Cart { checked(order) { if (order==null) return; } }'),
    },
  ]);

  expect(logicOfIn(files, 'charge')?.map(({ change, movedTo }) => ({ change, movedTo }))).toEqual([
    { change: 'moved', movedTo: 'Cart.checked' },
  ]);
});

const lostOf = (base: ReadonlyArray<string>, head: ReadonlyArray<string>, name = 'charge') =>
  logicOfIn(
    symbolChangesOf([{ node: 'a', before: read(...base), after: read(...head) }]),
    name,
  )?.map(({ change, movedTo }) => ({ change, movedTo }));

test('a decision an edited function gained takes one lost elsewhere; what it already had does not', () => {
  expect(
    lostOf(
      [
        'function charge(a) { if (!a) return; pay(); }',
        'function check(a) { if (a.late) warn(); }',
      ],
      [
        'function charge(a) { pay(); }',
        'function check(a) { if (a.late) warn(); if (!a) return; }',
      ],
    ),
  ).toEqual([{ change: 'moved', movedTo: 'check' }]);

  expect(
    lostOf(
      ['function charge(a) { if (!a) return; pay(); }', 'function check(a) { if (!a) return; }'],
      [
        'function charge(a) { pay(); }',
        'function check(a) { if (!a) return; if (a.late) warn(); }',
      ],
    ),
  ).toEqual([{ change: 'removed', movedTo: undefined }]);
});

test.for([
  {
    reason: 'two lost and one gained: the first moved, the second still lost',
    base: ['function charge(a) { if (!a) return; pay(); if (!a) return; }'],
    head: ['function charge(a) { pay(); }', 'function check(a) { if (!a) return; }'],
    lines: [
      { change: 'moved', movedTo: 'check' },
      { change: 'removed', movedTo: undefined },
    ],
  },
  {
    reason: 'a condition reworded on the way',
    base: ['function charge(a) { if (!a) return; pay(); }'],
    head: ['function charge(a) { pay(); }', 'function check(a) { if (!a.id) return; }'],
    lines: [{ change: 'removed', movedTo: undefined }],
  },
  {
    reason: 'a decision it keeps, though another function gained the same',
    base: ['function charge(a) { if (!a) return; if (b) pay(); }', 'function check(a) { warn(); }'],
    head: ['function charge(a) { if (!a) return; }', 'function check(a) { if (!a) return; }'],
    lines: [
      { change: 'same', movedTo: undefined },
      { change: 'removed', movedTo: undefined },
    ],
  },
  {
    reason: 'a decision that only moved inside its own function',
    base: ['function charge(a) { if (!a) return; if (b) pay(); }'],
    head: ['function charge(a) { if (b) pay(); if (!a) return; }'],
    lines: [
      { change: 'removed', movedTo: undefined },
      { change: 'same', movedTo: undefined },
      { change: 'added', movedTo: undefined },
    ],
  },
])('stays as it reads: $reason', ({ base, head, lines }) => {
  expect(lostOf(base, head)).toEqual(lines);
});

test('a new function holds what a removed one held: only the rest of it was gained', () => {
  const base = [
    'function charge(a) { if (!a) return; pay(); }',
    'function check(a) { if (!a) return; warn(); }',
  ];
  const rewritten = (...guards: ReadonlyArray<string>) => [
    'function charge(a) { pay(); }',
    `function verify(b, c, d) { ${guards.join(' ')} log(b); audit(c); notify(d); send(b, c, d); }`,
  ];

  expect(lostOf(base, rewritten('if (!a) return;'))).toEqual([
    { change: 'removed', movedTo: undefined },
  ]);
  expect(lostOf(base, rewritten('if (!a) return;', 'if (!a) return;'))).toEqual([
    { change: 'moved', movedTo: 'verify' },
  ]);
  expect(
    lostOf(
      ['function charge(a) { if (!a) return; pay(); }', 'function check(a) { if (z) warn(); }'],
      rewritten('if (!a) return;'),
    ),
  ).toEqual([{ change: 'moved', movedTo: 'verify' }]);
});

test('a function moved between files and edited brought its guard, so what another lost stays lost', () => {
  const files = symbolChangesOf([
    {
      node: 'a',
      before: read(
        'function charge(a) { if (!a) return; pay(); }',
        'function check(a) { if (!a) return; }',
      ),
      after: read('function charge(a) { pay(); }'),
    },
    { node: 'b', before: none, after: read('function check(a) { if (!a) return; warn(); }') },
  ]);

  expect(logicOfIn(files, 'charge')?.map(({ change }) => change)).toEqual(['removed']);
});

test('a gained decision of the same text but another kind takes no lost one', () => {
  const after = read('function charge(a) { pay(); }', 'function check(a) { if (!a) return; }');
  const files = symbolChangesOf([
    {
      node: 'a',
      before: read('function charge(a) { if (!a) return; pay(); }'),
      after: {
        ...after,
        symbols: after.symbols.map(symbol => ({
          ...symbol,
          decisions: symbol.decisions?.map(decision => ({ ...decision, kind: 'if' as const })),
        })),
      },
    },
  ]);

  expect(logicOfIn(files, 'charge')?.map(({ change }) => change)).toEqual(['removed']);
});

test('a whole function moved between files gained nothing, so what another lost stays lost', () => {
  const moving = 'function check(a) { if (!a) return; }';
  const files = symbolChangesOf([
    {
      node: 'a',
      before: read('function charge(a) { if (!a) return; pay(); }', moving),
      after: read('function charge(a) { pay(); }'),
    },
    { node: 'b', before: none, after: read(moving) },
  ]);

  expect(files.flatMap(file => file.symbols).map(({ name, change }) => ({ name, change }))).toEqual(
    [
      { name: 'charge', change: 'edited' },
      { name: 'check', change: 'moved' },
      { name: 'check', change: 'moved' },
    ],
  );
  expect(logicOfIn(files, 'charge')?.map(({ change }) => change)).toEqual(['removed']);
});
