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

test('a def is a method scoped by its constant, a setter by the name it sets, a top-level one a function', () => {
  expect(
    symbolsIn(
      'def helper; end',
      'class Shop',
      '  def open; end',
      '  def price=(value); end',
      '  def nested',
      '    def inner; end',
      '  end',
      'end',
    ),
  ).toEqual([
    'function helper',
    'class Shop',
    'method Shop.open',
    'setter Shop.price',
    'method Shop.nested',
  ]);
});

test('a file that does not parse throws, and so does one too big to read', () => {
  expect(() => read('class Shop', '  def open(', 'end')).toThrow('parse');
  expect(() => read(`# ${'x'.repeat(1001)}`)).toThrow('too big');
});

const exportedIn = (...lines: ReadonlyArray<string>) =>
  read(...lines)
    .symbols.filter(({ exported, kind }) => exported && kind !== 'class')
    .map(({ name }) => name);

test('a bare private or protected holds until public, in its own body only, and initialize stays public', () => {
  expect(
    exportedIn(
      'class Shop',
      '  def first; end',
      '  log(private)',
      '  def second; end',
      '  private',
      '  reload',
      '  def hidden; end',
      '  def initialize; end',
      '  included do',
      '    def block; end',
      '    private',
      '  end',
      '  def still_hidden; end',
      '  class Inner',
      '    def inner; end',
      '  end',
      '  protected',
      '  def guarded; end',
      '  public',
      '  def last; end',
      'end',
    ),
  ).toEqual(['first', 'second', 'initialize', 'block', 'inner', 'last']);
});
