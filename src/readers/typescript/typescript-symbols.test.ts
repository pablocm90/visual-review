import { expect, test } from 'vitest';
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
    exported: ['charge', 'refund', 'Shop', 'Shop.open', 'Shop.refresh', 'Id', 'default'],
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
