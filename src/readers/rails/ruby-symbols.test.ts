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

test('def self.x, and a def in class << self or class_methods do, is the method self.x, public under a bare private', () => {
  expect(
    symbolsIn(
      'class Shop',
      '  private',
      '  def self.build; end',
      '  def Shop.make; end',
      '  class << self',
      '    def open; end',
      '    class Inner',
      '      def plain; end',
      '    end',
      '    private',
      '    def hidden; end',
      '  end',
      '  class_methods do',
      '    def close; end',
      '  end',
      'end',
    ),
  ).toEqual([
    'class Shop',
    'method Shop.self.build',
    'method Shop.Shop.make',
    'method Shop.self.open',
    'class Shop::Inner',
    'method Shop::Inner.plain',
    'method Shop.self.hidden',
    'method Shop.self.close',
  ]);
  expect(
    exportedIn(
      'class Shop',
      '  private',
      '  def self.build; end',
      '  class << self',
      '    def open; end',
      '    private',
      '    def hidden; end',
      '  end',
      '  class_methods do',
      '    def close; end',
      '  end',
      '  def own; end',
      'end',
    ),
  ).toEqual(['self.build', 'self.open', 'self.close']);
});

test('a bare module_function makes what follows self.x and public, until a visibility word', () => {
  expect(
    symbolsIn(
      'module Prices',
      '  def plain; end',
      '  private',
      '  def hidden; end',
      '  module_function',
      '  def round; end',
      '  private',
      '  def after; end',
      'end',
    ),
  ).toEqual([
    'class Prices',
    'method Prices.plain',
    'method Prices.hidden',
    'method Prices.self.round',
    'method Prices.after',
  ]);
  expect(
    exportedIn(
      'module Prices',
      '  private',
      '  def hidden; end',
      '  module_function',
      '  def round; end',
      '  public',
      '  def plain; end',
      'end',
    ),
  ).toEqual(['self.round', 'plain']);
});

test('a visibility call with a def in it sets that def alone, and private_class_method a def self.x', () => {
  const lines = [
    'class Shop',
    '  private def hidden; end',
    '  def plain; end',
    '  protected def guarded; end',
    '  private_class_method def self.secret; end',
    '  def self.open; end',
    '  private',
    '  public def shown; end',
    '  module_function def round; end',
    '  def still_hidden; end',
    'end',
  ];

  expect(exportedIn(...lines)).toEqual(['plain', 'self.open', 'shown', 'self.round']);
  expect(symbolsIn(...lines)).toContain('method Shop.still_hidden');
});

test('a visibility call naming a method sets it wherever the def stands in that body, the last call winning', () => {
  expect(
    exportedIn(
      'class Shop',
      '  def hidden; end',
      '  def price=(value); end',
      '  def price; end',
      '  def guarded; end',
      '  def again; end',
      '  def self.secret; end',
      '  def self.open; end',
      '  class << self',
      '    def made; end',
      '    def tucked; end',
      '    def kept; end',
      '    private :tucked',
      '  end',
      '  class Inner',
      '    def hidden; end',
      '  end',
      '  private :hidden, :price=',
      '  protected :guarded',
      '  private :again',
      '  public :again',
      '  private_class_method :secret, :made',
      '  private',
      '  def back; end',
      '  public :back',
      'end',
    ),
  ).toEqual(['price', 'again', 'self.open', 'self.kept', 'hidden', 'back']);
});

test('module_function naming a method makes it self.x and public', () => {
  const lines = [
    'module Prices',
    '  private',
    '  def round; end',
    '  def plain; end',
    '  module_function :round',
    'end',
  ];

  expect(symbolsIn(...lines)).toEqual([
    'class Prices',
    'method Prices.self.round',
    'method Prices.plain',
  ]);
  expect(exportedIn(...lines)).toEqual(['self.round']);
});

test('private_constant hides the class, what it scopes and the constants below it', () => {
  const exported = read(
    'class Shop',
    '  class Inner',
    '    def open; end',
    '    class Deep',
    '      def close; end',
    '    end',
    '  end',
    '  class Innermost',
    '    def shown; end',
    '  end',
    '  def own; end',
    '  private_constant :Inner',
    'end',
    'class Inner; end',
  )
    .symbols.filter(symbol => symbol.exported)
    .map(({ name }) => name);

  expect(exported).toEqual(['Shop', 'Shop::Innermost', 'shown', 'own', 'Inner']);
});

test('attr_reader, attr_writer and attr_accessor read as a getter and a setter per name, by visibility', () => {
  const lines = [
    'class Shop',
    '  attr_reader :open, :close',
    '  attr_writer :price',
    '  attr_accessor :rent',
    '  private attr_reader :hidden',
    '  attr_reader :renamed',
    '  private :renamed',
    '  class << self',
    '    attr_reader :count',
    '  end',
    '  private',
    '  attr_writer :secret',
    'end',
  ];

  expect(symbolsIn(...lines)).toEqual([
    'class Shop',
    'getter Shop.open',
    'getter Shop.close',
    'setter Shop.price',
    'getter Shop.rent',
    'setter Shop.rent',
    'getter Shop.hidden',
    'getter Shop.renamed',
    'getter Shop.self.count',
    'setter Shop.secret',
  ]);
  expect(exportedIn(...lines)).toEqual(['open', 'close', 'price', 'rent', 'rent', 'self.count']);
});
