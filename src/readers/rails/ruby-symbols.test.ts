import { expect, test } from 'vitest';
import type { FileSymbols } from '../../core/reader.ts';
import { railsReader } from './reader.ts';

const source = (...lines: ReadonlyArray<string>) => lines.join('\n');

const read = (...lines: ReadonlyArray<string>): FileSymbols => {
  const file = railsReader.symbols?.(source(...lines), 'app/models/shop.rb');
  if (file === undefined) throw new Error('read no symbols');
  return file;
};

const symbolsIn = (...lines: ReadonlyArray<string>) =>
  read(...lines).symbols.map(
    ({ kind, scope, name }) => `${kind} ${scope === undefined ? '' : `${scope}.`}${name}`,
  );

test('a class or module is a symbol named by its full constant, with no scope', () => {
  expect(
    symbolsIn(
      'class Shop; end',
      'module Admin',
      '  class Reports::Daily; end',
      '  class ::Top; end',
      '  module Billing',
      '    class Invoice; end',
      '  end',
      'end',
    ),
  ).toEqual([
    'class Shop',
    'class Admin',
    'class Admin::Reports::Daily',
    'class Top',
    'class Admin::Billing',
    'class Admin::Billing::Invoice',
  ]);
});

test("a class's signature is its superclass", () => {
  const signatures = read('class Shop < Base::Record; end', 'module Admin; end').symbols.map(
    ({ signature }) => signature,
  );

  expect(signatures).toEqual(['< Base::Record', '']);
});

test('a test file reads no symbols', () => {
  expect(railsReader.symbols?.('class ShopTest; end', 'test/models/shop_test.rb')).toBeUndefined();
  expect(railsReader.symbols?.('class ShopSpec; end', 'spec/models/shop_spec.rb')).toBeUndefined();
});
