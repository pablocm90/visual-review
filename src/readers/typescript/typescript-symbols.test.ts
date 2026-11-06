import { expect, test } from 'vitest';
import { typeScriptReader } from './reader.ts';
import { symbolsOfTypeScript } from './typescript-symbols.ts';

const source = (...lines: ReadonlyArray<string>) => lines.join('\n');

const symbolsIn = (...lines: ReadonlyArray<string>) =>
  symbolsOfTypeScript(source(...lines), 'src/shop.ts').symbols.map(
    ({ kind, scope, name }) => `${kind} ${scope === undefined ? '' : `${scope}.`}${name}`,
  );

test('a function, class or type is a symbol, a method one scoped by its class or object, an inner function by the symbols around it', () => {
  expect(
    symbolsIn(
      'export function declared() {}',
      'export default function () {}',
      'const arrow = () => 1;',
      'function load() {',
      '  items.forEach(item => {});',
      '  const helper = () => {};',
      '  const api = { get() {} };',
      '}',
      'class Shop {',
      '  open() { function inner() {} }',
      '  static close = () => {};',
      '  #secret() {}',
      '  #hidden = () => {};',
      '}',
      'const store = { load() {}, save: () => {} };',
      'const Button = forwardRef(() => {});',
      'export default class { open() {} }',
      'type Id = string;',
      'export interface Order { readonly id: Id }',
      'enum Size { Small }',
    ),
  ).toEqual([
    'function declared',
    'function default',
    'function arrow',
    'function load',
    'function load.helper',
    'method load.api.get',
    'class Shop',
    'method Shop.open',
    'function Shop.open.inner',
    'method Shop.close',
    'method Shop.#secret',
    'method Shop.#hidden',
    'method store.load',
    'method store.save',
    'function Button',
    'class default',
    'method default.open',
    'type Id',
    'type Order',
    'type Size',
  ]);
});

const exportedIn = (...lines: ReadonlyArray<string>) =>
  symbolsOfTypeScript(source(...lines), 'src/shop.ts')
    .symbols.filter(({ exported }) => exported)
    .map(({ scope, name }) => `${scope === undefined ? '' : `${scope}.`}${name}`);

test.each([
  {
    exports: 'on their declarations, with an anonymous default',
    lines: [
      'export function charge() { function inner() {} }',
      'export const refund = () => {}, rate = 2;',
      'export const api: Api = { load() {} };',
      'export const checkout = { pay() {} } satisfies Api;',
      'export const settings = { save() {} } as const;',
      'export class Shop {',
      '  open() {}',
      '  protected refresh() {}',
      '  private close() {}',
      '  private static reset = () => {};',
      '  #secret() {}',
      '  #hidden = () => {};',
      '}',
      'export type Id = string;',
      'export default function () {}',
      'function local() {}',
      'class Hidden { open() {} }',
    ],
    exported: [
      'charge',
      'refund',
      'api.load',
      'checkout.pay',
      'settings.save',
      'Shop',
      'Shop.open',
      'Shop.refresh',
      'Id',
      'default',
    ],
  },
  {
    exports: 'in an export list, renamed or not, with a default naming a local',
    lines: [
      'function charge() {}',
      'const refund = () => {};',
      'const store = { load() {}, save: () => {} };',
      'function local() {}',
      'interface Order {}',
      'export { charge, refund as giveBack };',
      'export type { Order };',
      'export { local } from "./elsewhere";',
      'export default store;',
    ],
    exported: ['charge', 'refund', 'store.load', 'store.save', 'Order'],
  },
])('symbols exported $exports are exported, their public methods too', ({ lines, exported }) => {
  expect(exportedIn(...lines)).toEqual(exported);
});

const signaturesIn = (...lines: ReadonlyArray<string>) =>
  symbolsOfTypeScript(source(...lines), 'src/shop.ts').symbols.map(
    ({ name, signature }) => `${name} ${signature}`,
  );

test("a function's signature is its type parameters, parameters and return type, whitespace collapsed", () => {
  expect(
    signaturesIn(
      'function plain(a, b) {}',
      'export async function charge<T extends Order>(',
      '  order: T,',
      '  { amount,',
      '    currency }: Money = ZERO,',
      '  ...rest: ReadonlyArray<string>',
      '): Promise<Receipt> {}',
      'const refund = async (id: string): Promise<void> => {};',
      'const save = function (draft: Draft) {};',
      'class Shop { *items(): Iterable<Item> {} close = () => {}; #lock(key) {} }',
      'const store = { load(id) {} };',
    ),
  ).toEqual([
    'plain (a, b)',
    'charge async <T extends Order>(order: T, { amount, currency }: Money = ZERO, ...rest: ReadonlyArray<string>): Promise<Receipt>',
    'refund async (id: string): Promise<void>',
    'save (draft: Draft)',
    'Shop ',
    'items *(): Iterable<Item>',
    'close ()',
    '#lock (key)',
    'load (id)',
  ]);
});

test("an overloaded function's signature is its overloads, joined, and it is one symbol", () => {
  expect(
    signaturesIn(
      'export function charge(order: Order): Receipt;',
      'export function charge(orders: Order[]): Receipt[];',
      'export function charge(input) { return input; }',
      'class Shop {',
      '  open(): void;',
      '  open(at: Date): void;',
      '  open(at?) {}',
      '  get size() { return 1; }',
      '  set size(value) {}',
      '}',
      'abstract class Till { abstract open(): void; }',
      'function open(at) {}',
    ),
  ).toEqual([
    'charge (order: Order): Receipt; (orders: Order[]): Receipt[]',
    'Shop ',
    'open (): void; (at: Date): void',
    'size ()',
    'size (value)',
    'Till abstract',
    'open (at)',
  ]);
});

test("a class's signature is its type parameters and heritage, a type's its whole declaration", () => {
  expect(
    signaturesIn(
      'class Plain {}',
      'export abstract class Shop<T extends Item>',
      '  extends Store<T>',
      '  implements Open, Close {}',
      'export default class extends Base {}',
      'type Id = string;',
      'export interface Order {',
      '  readonly id: Id;',
      '}',
      'enum Size { Small, Large }',
    ),
  ).toEqual([
    'Plain ',
    'Shop abstract <T extends Item> extends Store<T> implements Open, Close',
    'default extends Base',
    'Id type Id = string;',
    'Order interface Order { readonly id: Id; }',
    'Size enum Size { Small, Large }',
  ]);
});

const bodiesAlike = (base: ReadonlyArray<string>, head: ReadonlyArray<string>) => {
  const heads = symbolsOfTypeScript(source(...head), 'src/shop.ts').symbols;
  return symbolsOfTypeScript(source(...base), 'src/shop.ts').symbols.map(
    ({ name, bodyHash }, index) => `${name} ${bodyHash === heads[index]?.bodyHash}`,
  );
};

test.each([
  {
    change: 'formatting, comments, quotes and parentheses',
    base: ["function charge(a) { return a + 'x'; }", 'function noop() {}'],
    head: [
      'function charge(a) {',
      '  // one more',
      '  return (a + "x"); // a string',
      '}',
      'function noop() { /* nothing */ }',
    ],
    alike: ['charge true', 'noop true'],
  },
  {
    change: 'the names of a function and a method',
    base: [
      'function charge(a) { return a; }',
      'class Shop { open() { return 1; } close = () => 2; }',
    ],
    head: [
      'function bill(a) { return a; }',
      'class Store { start() { return 1; } shut = () => 2; }',
    ],
    alike: ['charge true', 'Shop true', 'open true', 'close true'],
  },
  {
    change: 'the logic',
    base: ['function charge(a) { return a + 1; }', 'function pack(a) { return { total: a }; }'],
    head: ['function charge(a) { return a - 1; }', 'function pack(a) { return { sum: a }; }'],
    alike: ['charge false', 'pack false'],
  },
  {
    change: 'the logic of an inner function only',
    base: ['function outer() { const inner = () => 1; return inner(); }'],
    head: ['function outer() { const inner = () => 2; return inner(); }'],
    alike: ['outer true', 'inner false'],
  },
])('bodies hash alike unless their logic changed: $change', ({ base, head, alike }) => {
  expect(bodiesAlike(base, head)).toEqual(alike);
});

const signaturesAlike = (base: ReadonlyArray<string>, head: ReadonlyArray<string>) => {
  const heads = symbolsOfTypeScript(source(...head), 'src/shop.ts').symbols;
  return symbolsOfTypeScript(source(...base), 'src/shop.ts').symbols.map(
    ({ name, signatureHash }, index) => `${name} ${signatureHash === heads[index]?.signatureHash}`,
  );
};

test.each([
  {
    change: 'rewrapped with separators and quotes',
    base: [
      "function charge(order: { id: string; kind: 'card' }) { return 1; }",
      'interface Order { readonly id: string }',
      'class Shop<T> extends Store<T> implements Open {}',
    ],
    head: [
      'function charge(order: {',
      '  id: string;',
      '  kind: "card";',
      '}) { return 2; }',
      'interface Order {',
      '  readonly id: string;',
      '}',
      'class Shop<T>',
      '  extends Store<T>',
      '  implements Open { open() {} }',
    ],
    alike: ['charge true', 'Order true', 'Shop true'],
  },
  {
    change: 'changed',
    base: [
      'function charge(order: Order) {}',
      'async function refund() {}',
      'function* items() {}',
      'function pick<T>(): T {}',
      'function total(): string {}',
      'class Shop<T> extends Store<T> {}',
      'class Cart<T> {}',
      'class Basket extends Store {}',
      'class Bag extends Store<string> {}',
      'abstract class Till {}',
      'interface Order { readonly id: string }',
      'function bill(a: string): void;',
      'function bill(a) {}',
    ],
    head: [
      'function charge(order: Order, retry: boolean) {}',
      'function refund() {}',
      'function items() {}',
      'function pick<T, U>(): T {}',
      'function total(): number {}',
      'class Shop<T> extends Store<T> implements Open {}',
      'class Cart<T, U> {}',
      'class Basket extends Till {}',
      'class Bag extends Store<number> {}',
      'class Till {}',
      'interface Order { readonly id: number }',
      'function bill(a: number): void;',
      'function bill(a) {}',
    ],
    alike: [
      'charge false',
      'refund false',
      'items false',
      'pick false',
      'total false',
      'Shop false',
      'Cart false',
      'Basket false',
      'Bag false',
      'Till false',
      'Order false',
      'bill false',
    ],
  },
])('signatures hash alike unless their API changed: $change', ({ base, head, alike }) => {
  expect(signaturesAlike(base, head)).toEqual(alike);
});

const textsAlike = (base: ReadonlyArray<string>, head: ReadonlyArray<string>) => {
  const heads = symbolsOfTypeScript(source(...head), 'src/shop.ts').symbols;
  return symbolsOfTypeScript(source(...base), 'src/shop.ts').symbols.map(
    ({ name, textHash }, index) => `${name} ${textHash === heads[index]?.textHash}`,
  );
};

test('a symbol hashes its own text apart from the symbols inside it, so a reformatted one shows', () => {
  expect(
    textsAlike(
      [
        'function charge(a) { return a; }',
        'const refund = () => 1;',
        'function same() { return 1; }',
        'class Shop { open() { return 1; } close() { function inner() {} } }',
        'class Till { count() { function add() {} } }',
        'function load() { const a = 1; const b = () => a; }',
        'function bill(a: number): number;',
        'function bill(a: unknown) { return 1; }',
        'function pay(a: number): number;',
        'function pay(a: unknown) { return 1; }',
      ],
      [
        'function charge(a) {',
        '  return a; // as is',
        '}',
        'const refund = () =>  1;',
        'function same() { return 1; }',
        '',
        'class Shop { open() { return 1; } close() { function inner() { } } }',
        'class Till { count() { function add() {} /* added */ } }',
        'function load() { const a =  1; const b = () => a; }',
        'function bill(a:  number): number;',
        'function bill(a: unknown) { return 1; }',
        'function pay(a: number): number;',
        'function pay(a: unknown) { return  1; }',
      ],
    ),
  ).toEqual([
    'charge false',
    'refund false',
    'same true',
    'Shop true',
    'open true',
    'close true',
    'inner false',
    'Till true',
    'count false',
    'add true',
    'load false',
    'b true',
    'bill false',
    'pay false',
  ]);
});

test("a symbol's body tokens are its source's tokens without its name, comments or the symbols inside it", () => {
  expect(
    symbolsOfTypeScript(
      source(
        'function charge(a) { /* add */ return a + 1; // one more',
        '}',
        'class Shop { open() { const inner = () => 1; } }',
      ),
      'src/shop.ts',
    ).symbols.map(({ name, bodyTokens }) => `${name}: ${bodyTokens.join(' ')}`),
  ).toEqual([
    'charge: function ( a ) { return a + 1 ; }',
    'Shop: class { }',
    'open: ( ) { const ; }',
    'inner: ( ) => 1',
  ]);
});

test('a file lists the names it exports, re-exports included', () => {
  expect(
    symbolsOfTypeScript(
      source(
        'export function charge() {}',
        'export const refund = () => {}, rate = 2;',
        'export class Shop {}',
        'export type Id = string;',
        'function local() {}',
        'export { local as kept, rate as fee };',
        'export { a, b as c } from "./elsewhere";',
        'export * from "./everything";',
        'export * as tools from "./tools";',
        'export default function () {}',
      ),
      'src/shop.ts',
    ).exports,
  ).toEqual([
    'charge',
    'refund',
    'rate',
    'Shop',
    'Id',
    'kept',
    'fee',
    'a',
    'c',
    '* from ./everything',
    'tools',
    'default',
  ]);
});

const filesAlike = (base: ReadonlyArray<string>, head: ReadonlyArray<string>) =>
  symbolsOfTypeScript(source(...base), 'src/shop.ts').astHash ===
  symbolsOfTypeScript(source(...head), 'src/shop.ts').astHash;

test.each([
  {
    change: 'reformatted and commented',
    base: ["import { a } from './a';", 'const RATE = 2;'],
    head: ['// rates', 'import { a } from "./a";', '', 'const RATE = (2);'],
    alike: true,
  },
  {
    change: 'given an import',
    base: ["import { a } from './a';", 'const RATE = 2;'],
    head: ["import { a } from './a';", "import { b } from './b';", 'const RATE = 2;'],
    alike: false,
  },
  {
    change: 'given another constant',
    base: ["import { a } from './a';", 'const RATE = 2;'],
    head: ["import { a } from './a';", 'const RATE = 3;'],
    alike: false,
  },
])('a file hashes alike unless its logic changed: $change', ({ base, head, alike }) => {
  expect(filesAlike(base, head)).toBe(alike);
});

test("the TS reader reads a source file's symbols, and none of a test file's or of a non-script file the graph draws, such as a JSON import", () => {
  const read = (path: string) =>
    typeScriptReader.symbols?.('export const charge = () => 1;', path)?.exports;

  expect([read('src/shop.ts'), read('src/shop.test.ts'), read('src/rates.json')]).toEqual([
    ['charge'],
    undefined,
    undefined,
  ]);
});

test.for([
  { reason: 'a line of 1,001 characters', text: `b;\na=${'1'.repeat(998)};` },
  { reason: '262,145 characters', text: `${'a;\n'.repeat(87_381)}  ` },
])('a file of $reason is too big to read symbols from, as it is to measure', ({ text }) => {
  expect(() => symbolsOfTypeScript(text, 'src/vendor.js')).toThrow(/too big/);
});

test('a symbol knows the lines it spans: from its first overload or decorator to its end, leaving out the comment above it', () => {
  const { symbols } = symbolsOfTypeScript(
    source(
      '/** Opens it. */',
      'export const open =',
      '  () => 1;',
      '',
      'function load(a: string): void;',
      'function load(a: number): void;',
      'function load(a: unknown) {',
      '}',
      'class Shop {',
      '  @logged',
      '  close() {',
      '  }',
      '  static wrapped = () => {',
      '  };',
      '}',
      '@sealed',
      'class Till {}',
      'const Held = forwardRef(() => {',
      '});',
      'type Id = string;',
    ),
    'src/shop.ts',
  );
  expect(symbols.map(({ name, lines }) => [name, lines.start, lines.end])).toEqual([
    ['open', 2, 3],
    ['load', 5, 8],
    ['Shop', 9, 15],
    ['close', 10, 12],
    ['wrapped', 13, 14],
    ['Till', 16, 17],
    ['Held', 18, 19],
    ['Id', 20, 20],
  ]);
});
