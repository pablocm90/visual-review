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
