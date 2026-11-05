import { expect, test } from 'vitest';
import type { FileSymbols } from '../../core/reader.ts';
import { symbolChanges } from '../../core/symbol-changes.ts';
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

const changesBetween = (before: ReadonlyArray<string>, after: ReadonlyArray<string>) =>
  symbolChanges({ before: read(...before), after: read(...after) });

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

test('a visibility word sent to another object leaves this class alone', () => {
  expect(
    exportedIn(
      'class Shop',
      '  def open; end',
      '  logger.private :open',
      '  logger.private def close; end',
      'end',
    ),
  ).toEqual(['open', 'close']);
});

test('delegate reads as a method per name, its prefix applied, signed by its target, by visibility', () => {
  const lines = [
    'class Shop',
    '  delegate :open, :close, to: :door',
    '  delegate :rent, :to => :lease',
    "  delegate :name, to: 'owner', prefix: true",
    '  delegate :cost, to: :lease, prefix: :monthly',
    "  delegate :size, to: :lease, prefix: 'floor'",
    '  delegate :term, to: :lease, prefix: false',
    '  delegate :fee, to: :lease, private: true',
    '  delegate :tax, to: :lease, private: false',
    '  private delegate :key, to: :door',
    '  delegate :rate, to: :lease, prefix: chosen',
    '  class << self',
    '    delegate :count, to: :all',
    '  end',
    'end',
  ];

  expect(
    read(...lines)
      .symbols.slice(1)
      .map(({ name, kind, signature }) => `${kind} ${name} ${signature}`),
  ).toEqual([
    'method open to: :door',
    'method close to: :door',
    'method rent to: :lease',
    "method owner_name to: 'owner'",
    'method monthly_cost to: :lease',
    'method floor_size to: :lease',
    'method term to: :lease',
    'method fee to: :lease',
    'method tax to: :lease',
    'method key to: :door',
    'method chosen_rate to: :lease',
    'method self.count to: :all',
  ]);
  expect(exportedIn(...lines)).toEqual([
    'open',
    'close',
    'rent',
    'owner_name',
    'monthly_cost',
    'floor_size',
    'term',
    'tax',
    'chosen_rate',
    'self.count',
  ]);
});

test('a scope with a callable reads as the public method self.x, a routes scope as nothing', () => {
  const lines = [
    'class Shop',
    '  private',
    '  scope :open, -> { where(open: true) }',
    '  scope :near, lambda { |place| where(place:) }',
    '  scope :hidden, -> { all }',
    '  private_class_method :hidden',
    '  scope :admin do',
    '  end',
    "  scope :api, module: 'api' do",
    '  end',
    'end',
  ];

  expect(symbolsIn(...lines)).toEqual([
    'class Shop',
    'method Shop.self.open',
    'method Shop.self.near',
    'method Shop.self.hidden',
  ]);
  expect(exportedIn(...lines)).toEqual(['self.open', 'self.near']);
});

test("a method's signature is its parameters, written either way, with no comments", () => {
  const signatures = read(
    'class Shop',
    '  def plain; end',
    '  def empty(); end',
    '  def bare a, b = 1',
    '  end',
    '  def self.made(*rest, key:, **options, &block); end',
    '  def wide(a,',
    '    # why',
    '    b); end',
    '  def spread(a = [1,',
    '    2]); end',
    'end',
  )
    .symbols.slice(1)
    .map(({ signature }) => signature);

  expect(signatures).toEqual([
    '',
    '',
    '(a, b = 1)',
    '(*rest, key:, **options, &block)',
    '(a, b)',
    '(a = [1, 2])',
  ]);
});

test.for([
  { edit: 'a comment', before: 'x = 1', after: '# why\nx = 1', kind: 'formatting' },
  { edit: 'whitespace', before: 'x = 1', after: 'x  =  1\n', kind: 'formatting' },
  { edit: 'a value', before: 'x = 1', after: 'x = 2', kind: 'logic' },
  { edit: 'a line break that ends a call', before: 'puts x', after: 'puts\nx', kind: 'logic' },
  { edit: 'the text of a string', before: 'x = "a b"', after: 'x = "a  b"', kind: 'logic' },
])('a file whose only change is $edit reads kind $kind', ({ before, after, kind }) => {
  expect(changesBetween([before], [after]).kind).toBe(kind);
});

const changesOf = (before: ReadonlyArray<string>, after: ReadonlyArray<string>) =>
  changesBetween(before, after).symbols.map(
    ({ change, scope, name }) => `${change} ${scope === undefined ? '' : `${scope}.`}${name}`,
  );

test.for([
  {
    edit: 'nothing',
    before: 'def open(a); a; end',
    after: 'def open(a); a; end',
    change: 'unchanged',
  },
  {
    edit: 'whitespace',
    before: 'def open(a); a; end',
    after: 'def open(a);   a; end',
    change: 'formatting',
  },
  {
    edit: 'a comment',
    before: 'def open(a); a; end',
    after: 'def open(a); a; # why\nend',
    change: 'formatting',
  },
  {
    edit: 'parentheses',
    before: 'def open(a); a; end',
    after: 'def open a; a; end',
    change: 'formatting',
  },
  {
    edit: 'its body',
    before: 'def open(a); a; end',
    after: 'def open(a); a + 1; end',
    change: 'edited',
  },
  {
    edit: 'a parameter',
    before: 'def open(a); 1; end',
    after: 'def open(b); 1; end',
    change: 'edited',
  },
])('a method with $edit changed reads $change', ({ before, after, change }) => {
  expect(changesOf([before], [after])).toEqual([`${change} open`]);
});

test.for([
  {
    edit: 'an edit elsewhere',
    before: ['attr_writer :x', 'def x=(v); v; end', 'def y; 1; end'],
    after: ['attr_writer :x', 'def x=(v); v; end', 'def y; 2; end'],
    changes: ['unchanged x', 'unchanged x', 'edited y'],
  },
  {
    edit: 'its second written edited',
    before: ['def x(a); 1; end', 'def x(a, b); 1; end'],
    after: ['def x(a); 1; end', 'def x(a, b); 2; end'],
    changes: ['unchanged x', 'edited x'],
  },
  {
    edit: 'its second written gone',
    before: ['def x(a); 1; end', 'def x(a, b); 1; end'],
    after: ['def x(a); 1; end'],
    changes: ['unchanged x', 'removed x'],
  },
])('a symbol written twice pairs in order, given $edit', ({ before, after, changes }) => {
  expect(changesOf(before, after)).toEqual(changes);
});

test("a method's signature change is told apart from its body's, whichever way it is written", () => {
  const signatureOf = (before: string, after: string) =>
    changesBetween([before], [after]).symbols[0]?.signature;

  expect(signatureOf('def open(a); 1; end', 'def open(b); 1; end')).toEqual({
    base: '(a)',
    head: '(b)',
  });
  expect(signatureOf('def open(a); 1; end', 'def open a; 2; end')).toBeUndefined();
  expect(signatureOf('def open(); 1; end', 'def open; 1; end')).toBeUndefined();
});

test('a method with the same body under another name reads renamed, a similar one probably', () => {
  const body = 'first = a + 1; second = first * 2; third = second - 3; third / 4';

  expect(
    changesBetween([`def open(a); ${body}; end`], [`def shut(a); ${body}; end`]).symbols,
  ).toMatchObject([{ name: 'shut', change: 'renamed', renamedFrom: 'open' }]);
  expect(
    changesBetween([`def open(a); ${body}; end`], [`def shut(a); ${body} + 5; end`]).symbols,
  ).toMatchObject([{ name: 'shut', change: 'renamed', renamedFrom: 'open', probably: true }]);
});

test('a scope with the same lambda under another name reads renamed', () => {
  expect(
    changesBetween(
      ['class Shop', '  scope :a, -> { where(open: true) }', 'end'],
      ['class Shop', '  scope :b, -> { where(open: true) }', 'end'],
    ).symbols[1],
  ).toMatchObject({ name: 'self.b', change: 'renamed', renamedFrom: 'Shop.self.a' });
});

test.for([
  {
    edit: 'an edit to a method in it',
    before: ['class Shop', '  NAME = "é"', '  def open; 1; end', 'end'],
    after: ['class Shop', '  NAME = "é"', '  def open; 2; end', 'end'],
    expected: ['unchanged Shop', 'edited Shop.open'],
  },
  {
    edit: 'an edit to a class in it',
    before: ['class Shop', '  class Till; X = 1; end', 'end'],
    after: ['class Shop', '  class Till; X = 2; end', 'end'],
    expected: ['unchanged Shop', 'edited Shop::Till'],
  },
  {
    edit: 'an edit to a method under private def',
    before: ['class Shop', '  private def open; 1; end', 'end'],
    after: ['class Shop', '  private def open; 2; end', 'end'],
    expected: ['unchanged Shop', 'edited Shop.open'],
  },
  {
    edit: 'an edit to a method in class << self',
    before: ['class Shop', '  class << self', '    def open; 1; end', '  end', 'end'],
    after: ['class Shop', '  class << self', '    def open; 2; end', '  end', 'end'],
    expected: ['unchanged Shop', 'edited Shop.self.open'],
  },
  {
    edit: 'a new method',
    before: ['class Shop', '  def open; 1; end', 'end'],
    after: ['class Shop', '  def open; 1; end', '  def shut; 1; end', 'end'],
    expected: ['edited Shop', 'unchanged Shop.open', 'added Shop.shut'],
  },
  {
    edit: 'a comment before its methods',
    before: ['class Shop', '  def open; 1; end', '  def shut; 1; end', 'end'],
    after: ['class Shop', '  # why', '  def open; 1; end', '  def shut; 1; end', 'end'],
    expected: ['formatting Shop', 'unchanged Shop.open', 'unchanged Shop.shut'],
  },
  {
    edit: 'a comment and an edit to a method in it',
    before: ['class Shop', '  def open; 1; end', 'end'],
    after: ['class Shop', '  # why', '  def open; 2; end', 'end'],
    expected: ['formatting Shop', 'edited Shop.open'],
  },
  {
    edit: 'an edit to a method, well into the file',
    before: ['# A long comment above the class', 'class Shop', '  def open; 1; end', 'end'],
    after: ['# A long comment above the class', 'class Shop', '  def open; 2; end', 'end'],
    expected: ['unchanged Shop', 'edited Shop.open'],
  },
  {
    edit: 'a comment after its method, well into the file',
    before: ['# A long comment above the class', 'class Shop', '  def open; 1; end', 'end'],
    after: [
      '# A long comment above the class',
      'class Shop',
      '  def open; 1; end',
      '  # why',
      'end',
    ],
    expected: ['formatting Shop', 'unchanged Shop.open'],
  },
  {
    edit: 'a line of its own',
    before: ['class Shop', '  def open; 1; end', 'end'],
    after: ['class Shop', '  include Till', '  def open; 1; end', 'end'],
    expected: ['edited Shop', 'unchanged Shop.open'],
  },
  {
    edit: 'a name added to an attr_reader',
    before: ['class Shop', '  attr_reader :a, :b', 'end'],
    after: ['class Shop', '  attr_reader :a, :b, :c', 'end'],
    expected: ['unchanged Shop', 'unchanged Shop.a', 'unchanged Shop.b', 'added Shop.c'],
  },
  {
    edit: 'an attr_reader turned into a def that does nothing',
    before: ['class Shop', '  attr_reader :a', 'end'],
    after: ['class Shop', '  def a; end', 'end'],
    expected: ['unchanged Shop', 'edited Shop.a'],
  },
  {
    edit: 'a name added to a delegate',
    before: ['class Shop', '  delegate :a, to: :door', 'end'],
    after: ['class Shop', '  delegate :a, :c, to: :door', 'end'],
    expected: ['unchanged Shop', 'unchanged Shop.a', 'added Shop.c'],
  },
  {
    edit: 'an option added to a delegate',
    before: ['class Shop', '  delegate :a, to: :door', 'end'],
    after: ['class Shop', '  delegate :a, to: :door, allow_nil: true', 'end'],
    expected: ['unchanged Shop', 'edited Shop.a'],
  },
  {
    edit: 'whitespace in a delegate',
    before: ['class Shop', '  delegate :a, to: :door', 'end'],
    after: ['class Shop', '  delegate :a, to:  :door', 'end'],
    expected: ['unchanged Shop', 'formatting Shop.a'],
  },
  {
    edit: "an edit to a scope's lambda",
    before: ['class Shop', '  scope :a, -> { where(open: true) }', 'end'],
    after: ['class Shop', '  scope :a, -> { where(open: false) }', 'end'],
    expected: ['unchanged Shop', 'edited Shop.self.a'],
  },
  {
    edit: "an edit to a scope's do block",
    before: ['class Shop', '  scope :a, lambda do', '    all', '  end', 'end'],
    after: ['class Shop', '  scope :a, lambda do', '    none', '  end', 'end'],
    expected: ['unchanged Shop', 'edited Shop.self.a'],
  },
  {
    edit: "a scope's receiver",
    before: ['class Shop', '  One.scope :a, -> { all }', 'end'],
    after: ['class Shop', '  Two.scope :a, -> { all }', 'end'],
    expected: ['unchanged Shop', 'edited Shop.self.a'],
  },
  {
    edit: 'whitespace in a scope',
    before: ['class Shop', '  scope :a, -> { all }', 'end'],
    after: ['class Shop', '  scope :a, -> {  all }', 'end'],
    expected: ['unchanged Shop', 'formatting Shop.self.a'],
  },
  {
    edit: 'an edit inside a scope that is no symbol',
    before: ['class Shop', '  scope :admin do', '    one', '  end', 'end'],
    after: ['class Shop', '  scope :admin do', '    two', '  end', 'end'],
    expected: ['edited Shop'],
  },
  {
    edit: 'a splat beside an attr_reader name',
    before: ['class Shop', '  attr_reader :a, *OLD', 'end'],
    after: ['class Shop', '  attr_reader :a, *NEW', 'end'],
    expected: ['edited Shop', 'unchanged Shop.a'],
  },
  {
    edit: 'an option beside an attr_reader name',
    before: ['class Shop', '  attr_reader :a, note: 1', 'end'],
    after: ['class Shop', '  attr_reader :a, note: 2', 'end'],
    expected: ['edited Shop', 'unchanged Shop.a'],
  },
  {
    edit: "an attr_reader's receiver",
    before: ['class Shop', '  One.attr_reader :a', 'end'],
    after: ['class Shop', '  Two.attr_reader :a', 'end'],
    expected: ['edited Shop', 'unchanged Shop.a'],
  },
  {
    edit: "an attr_reader's block",
    before: ['class Shop', '  attr_reader(:a) { 1 }', 'end'],
    after: ['class Shop', '  attr_reader(:a) { 2 }', 'end'],
    expected: ['edited Shop', 'unchanged Shop.a'],
  },
  {
    edit: 'a comment between attr_reader names',
    before: ['class Shop', '  attr_reader :a,', '    :b', 'end'],
    after: ['class Shop', '  attr_reader :a, # why', '    :b', 'end'],
    expected: ['unchanged Shop', 'unchanged Shop.a', 'unchanged Shop.b'],
  },
  {
    edit: 'a splat beside a delegate name',
    before: ['class Shop', '  delegate :a, *OLD, to: :door', 'end'],
    after: ['class Shop', '  delegate :a, *NEW, to: :door', 'end'],
    expected: ['edited Shop', 'unchanged Shop.a'],
  },
  {
    edit: "a delegate's receiver",
    before: ['class Shop', '  One.delegate :a, to: :door', 'end'],
    after: ['class Shop', '  Two.delegate :a, to: :door', 'end'],
    expected: ['edited Shop', 'unchanged Shop.a'],
  },
  {
    edit: "a delegate's block",
    before: ['class Shop', '  delegate(:a, to: :door) { 1 }', 'end'],
    after: ['class Shop', '  delegate(:a, to: :door) { 2 }', 'end'],
    expected: ['edited Shop', 'unchanged Shop.a'],
  },
])('with $edit, a class and what it holds read apart', ({ before, after, expected }) => {
  expect(changesOf(before, after)).toEqual(expected);
});

test("a class's superclass is its signature", () => {
  expect(
    changesBetween(['class Shop < Base; end'], ['class Shop < Other; end']).symbols,
  ).toMatchObject([{ change: 'edited', signature: { base: '< Base', head: '< Other' } }]);
});

test("a delegate's target is its signature", () => {
  const signatureOf = (before: string, after: string) =>
    changesBetween([before], [after]).symbols[0]?.signature;

  expect(signatureOf('delegate :a, to: :door', 'delegate :a, to: :gate')).toEqual({
    base: 'to: :door',
    head: 'to: :gate',
  });
  expect(
    signatureOf('delegate :a, to: :door', 'delegate :a, to: :door, prefix: false'),
  ).toBeUndefined();
});
