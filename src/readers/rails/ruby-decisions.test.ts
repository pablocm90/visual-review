import { expect, test } from 'vitest';
import { symbolChanges } from '../../core/symbol-changes.ts';
import { symbolFindings } from '../../core/symbol-findings.ts';
import { railsReader } from './reader.ts';

const decisionsIn = (...lines: ReadonlyArray<string>) =>
  railsReader
    .symbols?.(['def charge', ...lines, 'end'].join('\n'), 'app/models/shop.rb')
    ?.symbols.find(({ name }) => name === 'charge')?.decisions;

test.for([
  { lines: ['return if x'], text: 'return if x' },
  { lines: ['return total unless x'], text: 'return unless x' },
  { lines: ['raise Foo unless y'], text: 'raise Foo unless y' },
  { lines: ['raise Foo, "no" unless y'], text: 'raise Foo unless y' },
  { lines: ['raise Foo.new("no") if y'], text: 'raise Foo if y' },
  { lines: ['raise "no" if y'], text: 'raise if y' },
  { lines: ['raise if y'], text: 'raise if y' },
  { lines: ['raise error if y'], text: 'raise error if y' },
  { lines: ['raise build("no") if y'], text: 'raise build("no") if y' },
  { lines: ['raise(', '  # why', '  Foo', ') if y'], text: 'raise Foo if y' },
  { lines: ['fail Foo if y'], text: 'fail Foo if y' },
  { lines: ['if x', '  return total', 'end'], text: 'return if x' },
  { lines: ['unless y', '  raise Foo, "no"', 'end'], text: 'raise Foo unless y' },
  { lines: ['if x', '  # why', '  return', 'end'], text: 'return if x' },
  { lines: ['return if a &&', '  # why', '  b'], text: 'return if a && b' },
  { lines: ['return if foo(', '  a,', '  b,', ')'], text: 'return if foo(a, b)' },
  { lines: ['raise build(', '  1', ') if y'], text: 'raise build(1) if y' },
  { lines: ['return if orders', '  .paid', '  &.any?'], text: 'return if orders.paid&.any?' },
  { lines: ['return if orders.', '  any?'], text: 'return if orders.any?' },
])('$lines reads as the guard $text', ({ lines, text }) => {
  expect(decisionsIn(...lines)).toEqual([{ kind: 'guard', text, depth: 0, line: 2 }]);
});

test.for([
  { lines: ['head :forbidden unless z'], text: 'head unless z' },
  { lines: ['render json: { a: 1 } if x'], text: 'render if x' },
  { lines: ['redirect_to root_path if x'], text: 'redirect_to if x' },
  { lines: ['render if x'], text: 'render if x' },
  { lines: ['if x', '  head :ok', 'end'], text: 'head if x' },
  { lines: ['render :a and return if x'], text: 'render and return if x' },
  { lines: ['render(:a) && return if x'], text: 'render and return if x' },
  { lines: ['if x', '  redirect_to a and return', 'end'], text: 'redirect_to and return if x' },
])('$lines reads as the guard $text, found by name', ({ lines, text }) => {
  expect(decisionsIn(...lines)).toEqual([
    { kind: 'guard', text, depth: 0, line: 2, foundByName: true },
  ]);
});

test('what follows a render in its guard reads one deeper, as a render does not exit', () => {
  expect(decisionsIn('if x', '  render :a', '  go if y', 'end')).toEqual([
    { kind: 'guard', text: 'render if x', depth: 0, line: 2, foundByName: true },
    { kind: 'if', text: 'if y', depth: 1, line: 4 },
  ]);
});

test.for([
  { lines: ['raise Foo and return if x'], text: 'if x' },
  { lines: ['render :a or return if x'], text: 'if x' },
  { lines: ['render :a and go if x'], text: 'if x' },
  { lines: ['go and return if x'], text: 'if x' },
  { lines: ['log.render :a if x'], text: 'if x' },
])('$lines is no guard', ({ lines, text }) => {
  expect(decisionsIn(...lines)?.[0]).toMatchObject({ kind: 'if', text });
});

test.for([
  { reason: 'a raise sent to another object', lines: ['log.raise Foo if y'] },
  { reason: 'an if with an else', lines: ['if x', '  return', 'else', '  go', 'end'] },
  { reason: 'an if opening with something else', lines: ['if x', '  go', '  return', 'end'] },
])('$reason is no guard', ({ lines }) => {
  expect(decisionsIn(...lines)?.filter(({ kind }) => kind === 'guard')).toEqual([]);
});

test.for([
  { lines: ['if x', '  go', 'end'], text: 'if x' },
  { lines: ['unless x', '  go', 'end'], text: 'unless x' },
  { lines: ['go if x'], text: 'if x' },
  { lines: ['go unless x'], text: 'unless x' },
  { lines: ['if x', '  go', '  return', 'end'], text: 'if x' },
])('$lines reads as the if $text', ({ lines, text }) => {
  expect(decisionsIn(...lines)?.[0]).toEqual({ kind: 'if', text, depth: 0, line: 2 });
});

test.for([
  { reason: 'a then branch', lines: ['if x', '  go if y', 'end'] },
  { reason: 'an else branch', lines: ['if x', '  go', 'else', '  go if y', 'end'] },
  { reason: 'a modifier body', lines: ['(go if y) if x'] },
])('an if in $reason reads one deeper', ({ lines }) => {
  expect(decisionsIn(...lines)?.map(({ text, depth }) => [text, depth])).toEqual([
    ['if x', 0],
    ['if y', 1],
  ]);
});

test('an elsif reads level with its if, and its branch one deeper', () => {
  const lines = ['if x', '  go', 'elsif y', '  go if z', 'elsif w', '  return', 'end'];
  expect(decisionsIn(...lines)).toEqual([
    { kind: 'if', text: 'if x', depth: 0, line: 2 },
    { kind: 'if', text: 'elsif y', depth: 0, line: 4 },
    { kind: 'if', text: 'if z', depth: 1, line: 5 },
    { kind: 'if', text: 'elsif w', depth: 0, line: 6 },
    { kind: 'return', text: 'return', depth: 1, line: 7 },
  ]);
});

test('a ternary reads its condition, and each branch one deeper', () => {
  expect(decisionsIn('y = a ? (b ? 1 : 2) : (c ? 3 : 4)')).toEqual([
    { kind: 'ternary', text: 'a ?', depth: 0, line: 2 },
    { kind: 'ternary', text: 'b ?', depth: 1, line: 2 },
    { kind: 'ternary', text: 'c ?', depth: 1, line: 2 },
  ]);
});

test.for([
  { lines: ['while w', '  go if y', 'end'], text: 'while w' },
  { lines: ['while w do', '  go if y', 'end'], text: 'while w' },
  { lines: ['until u', '  go if y', 'end'], text: 'until u' },
  { lines: ['for i in xs', '  go if y', 'end'], text: 'for i in xs' },
  { lines: ['for i, j in xs do', '  go if y', 'end'], text: 'for i, j in xs' },
  { lines: ['(go if y) while w'], text: 'while w' },
  { lines: ['(go if y) until u'], text: 'until u' },
])('$lines reads as the loop $text, its body one deeper', ({ lines, text }) => {
  expect(decisionsIn(...lines)?.map(({ kind, text, depth }) => [kind, text, depth])).toEqual([
    ['loop', text, 0],
    ['if', 'if y', 1],
  ]);
});

test.for([
  { lines: ['orders.each do |o|', '  go if y', 'end'], text: 'orders.each do' },
  { lines: ['orders.each { |o| go if y }'], text: 'orders.each do' },
  { lines: ['orders.each_with_index { |o, i| go if y }'], text: 'orders.each_with_index do' },
  { lines: ['orders.each_slice(10) { |o| go if y }'], text: 'orders.each_slice(10) do' },
  { lines: ['orders.find_each { |o| go if y }'], text: 'orders.find_each do' },
  { lines: ['orders.find_in_batches { |o| go if y }'], text: 'orders.find_in_batches do' },
  { lines: ['3.times { go if y }'], text: '3.times do' },
  { lines: ['loop { go if y }'], text: 'loop do' },
  { lines: ['each { go if y }'], text: 'each do' },
])('$lines reads as the loop $text, found by name, its block one deeper', ({ lines, text }) => {
  expect(decisionsIn(...lines)).toEqual([
    { kind: 'loop', text, depth: 0, line: 2, foundByName: true },
    { kind: 'if', text: 'if y', depth: 1, line: expect.any(Number) },
  ]);
});

test.for([
  { reason: 'a map block', lines: ['orders.map { |o| go if y }'] },
  { reason: 'an each with no block', lines: ['orders.each(&:go)', 'go if y'] },
])('$reason is no loop, and what is inside it stays level', ({ lines }) => {
  expect(decisionsIn(...lines)?.map(({ kind, depth }) => [kind, depth])).toEqual([['if', 0]]);
});

test.for([
  { reason: 'its receiver', kind: 'if', lines: ['orders.select { go if y }.each { go }'] },
  { reason: 'its arguments', kind: 'ternary', lines: ['orders.each_slice(a ? 1 : 2) { go }'] },
])('what is in $reason reads level with the loop, ahead of it', ({ kind, lines }) => {
  expect(decisionsIn(...lines)?.map(({ kind, depth }) => [kind, depth])).toEqual([
    [kind, 0],
    ['loop', 0],
  ]);
});

test('a case reads each when and its else, their bodies one deeper', () => {
  const lines = [
    'case x',
    'when 1, 2 then go if y',
    'when 3',
    '  go if z',
    'when 4',
    'else',
    '  go if w',
    'end',
  ];
  expect(decisionsIn(...lines)).toEqual([
    { kind: 'case', text: 'when 1, 2', depth: 0, line: 3 },
    { kind: 'if', text: 'if y', depth: 1, line: 3 },
    { kind: 'case', text: 'when 3', depth: 0, line: 4 },
    { kind: 'if', text: 'if z', depth: 1, line: 5 },
    { kind: 'case', text: 'when 4', depth: 0, line: 6 },
    { kind: 'case', text: 'else', depth: 0, line: 7 },
    { kind: 'if', text: 'if w', depth: 1, line: 8 },
  ]);
});

test('a case in reads each pattern, with its guard, and its else', () => {
  const lines = ['case x', 'in [a]', '  go if y', 'in {b:} if c', '  go', 'else', '  go', 'end'];
  expect(decisionsIn(...lines)).toEqual([
    { kind: 'case', text: 'in [a]', depth: 0, line: 3 },
    { kind: 'if', text: 'if y', depth: 1, line: 4 },
    { kind: 'case', text: 'in {b:} if c', depth: 0, line: 5 },
    { kind: 'case', text: 'else', depth: 0, line: 7 },
  ]);
});

test('an else of a begin is no decision, what is in it stays level', () => {
  const lines = ['begin', '  go', 'rescue', '  no', 'else', '  go if y', 'end'];
  expect(decisionsIn(...lines)?.filter(({ text }) => text !== 'rescue')).toEqual([
    { kind: 'if', text: 'if y', depth: 0, line: 7 },
  ]);
});

test.for([
  { line: 'y = a || (go if z)', text: 'a ||' },
  { line: 'y = a && (go if z)', text: 'a &&' },
  { line: 'a and (go if z)', text: 'a and' },
  { line: 'a or (go if z)', text: 'a or' },
  { line: 'y ||= (go if z)', text: 'y ||=' },
  { line: 'y &&= (go if z)', text: 'y &&=' },
])('$line reads as the logical $text, its right side one deeper', ({ line, text }) => {
  expect(decisionsIn(line)).toEqual([
    { kind: 'logical', text, depth: 0, line: 2 },
    { kind: 'if', text: 'if z', depth: 1, line: 2 },
  ]);
});

test('only the outermost of a chain of logicals reads', () => {
  expect(decisionsIn('y = a && b || c')?.map(({ text }) => text)).toEqual(['a && b ||']);
});

test.for([
  { reason: 'a comparison', line: 'y = a == b' },
  { reason: 'a sum', line: 'y = a + b' },
  { reason: 'an adding assignment', line: 'y += 1' },
])('$reason is no logical', ({ line }) => {
  expect(decisionsIn(line)).toEqual([]);
});

test('a rescue reads as a catch by its head, its body one deeper', () => {
  const lines = ['begin', '  go', 'rescue Foo, Bar => e', '  go if y', 'rescue', 'end'];
  expect(decisionsIn(...lines)).toEqual([
    { kind: 'catch', text: 'rescue Foo, Bar => e', depth: 0, line: 4 },
    { kind: 'if', text: 'if y', depth: 1, line: 5 },
    { kind: 'catch', text: 'rescue', depth: 0, line: 6 },
  ]);
});

test('a rescue modifier reads what it falls to, its body level and its handler one deeper', () => {
  expect(
    decisionsIn('(go if y) rescue (go if z)')?.map(({ kind, text, depth }) => [kind, text, depth]),
  ).toEqual([
    ['if', 'if y', 0],
    ['catch', 'rescue (go if z)', 0],
    ['if', 'if z', 1],
  ]);
});

test.for([
  { reason: 'an if', lines: ['if x', '  go', '  return', 'end'], kind: 'if', text: 'if x' },
  { reason: 'a loop', lines: ['while w', '  return', 'end'], kind: 'loop', text: 'while w' },
  {
    reason: 'a render guard',
    lines: ['if x', '  render :a', '  return', 'end'],
    kind: 'guard',
    text: 'render if x',
  },
])('a return in $reason reads one deeper', ({ lines, kind, text }) => {
  expect(decisionsIn(...lines)?.map(({ kind, text, depth }) => [kind, text, depth])).toEqual([
    [kind, text, 0],
    ['return', 'return', 1],
  ]);
});

test('a return at the top of a method is no decision, what it returns still reads', () => {
  expect(decisionsIn('return a ? 1 : 2')).toEqual([
    { kind: 'ternary', text: 'a ?', depth: 0, line: 2 },
  ]);
});

test('what a return in a branch returns reads one deeper than it', () => {
  expect(
    decisionsIn('while w', '  return a ? 1 : 2', 'end')?.map(({ kind, depth }) => [kind, depth]),
  ).toEqual([
    ['loop', 0],
    ['return', 1],
    ['ternary', 2],
  ]);
});

test.for([
  { line: 'raise Foo', text: 'raise Foo' },
  { line: 'raise Foo, "no"', text: 'raise Foo' },
  { line: 'raise', text: 'raise' },
  { line: 'fail Foo.new(a ? 1 : 2)', text: 'fail Foo' },
  { line: 'fail', text: 'fail' },
])('$line reads as the throw $text, and nothing in it reads', ({ line, text }) => {
  expect(decisionsIn(line)).toEqual([{ kind: 'throw', text, depth: 0, line: 2 }]);
});

test('a raise in a branch reads one deeper', () => {
  expect(decisionsIn('y || raise(Foo)')).toEqual([
    { kind: 'logical', text: 'y ||', depth: 0, line: 2 },
    { kind: 'throw', text: 'raise Foo', depth: 1, line: 2 },
  ]);
});

test.for([
  { reason: 'a raise sent to another object', lines: ['log.raise Foo'] },
  { reason: 'a raise sent to another object, bare', lines: ['log.raise'] },
  { reason: 'a word not a throw', lines: ['go Foo'] },
])('$reason is no throw', ({ lines }) => {
  expect(decisionsIn(...lines)).toEqual([]);
});

test('a method named after a throw reads none', () => {
  const symbols = railsReader.symbols?.('def fail\n  go\nend', 'app/models/shop.rb')?.symbols;
  expect(symbols?.[0]?.decisions).toEqual([]);
});

test('an endless method reads its body', () => {
  const symbols = railsReader.symbols?.('def charge = a ? 1 : 2', 'app/models/shop.rb')?.symbols;
  expect(symbols?.[0]?.decisions).toEqual([{ kind: 'ternary', text: 'a ?', depth: 0, line: 1 }]);
});

const shopDecisions = (...lines: ReadonlyArray<string>) =>
  railsReader
    .symbols?.(['class Shop', ...lines, 'end'].join('\n'), 'app/models/shop.rb')
    ?.symbols.find(({ name }) => name === 'Shop')?.decisions;

test.for([
  'before_action :a, only: :b',
  'prepend_before_action :a',
  'append_before_action :a',
  'skip_before_action :a',
  'around_action :a',
  'prepend_around_action :a',
  'skip_around_action :a',
  'before_save :a',
  'before_validation :a',
  'before_create :a',
  'validates :a, presence: true',
  'validate :a',
  'validates_presence_of :a',
])('%s in a class body reads as a guard on the class, found by name', line => {
  expect(shopDecisions(line)).toEqual([
    { kind: 'guard', text: line, depth: 0, line: 2, foundByName: true },
  ]);
});

test('rescue_from in a class body reads as a catch on the class, not found by name', () => {
  expect(shopDecisions('rescue_from Foo, with: :a')).toEqual([
    { kind: 'catch', text: 'rescue_from Foo, with: :a', depth: 0, line: 2 },
  ]);
});

test('a macro reads on one line', () => {
  expect(shopDecisions('before_action :a,', '  # why', '  only: :b')?.[0]?.text).toBe(
    'before_action :a, only: :b',
  );
});

test.for([
  { reason: 'included', lines: ['included do', '  before_action :a', 'end'] },
  { reason: 'with_options', lines: ['with_options if: :b do', '  before_action :a', 'end'] },
])('a macro in a $reason block reads on the class', ({ lines }) => {
  expect(shopDecisions(...lines)?.map(({ kind, text }) => [kind, text])).toEqual([
    ['guard', 'before_action :a'],
  ]);
});

test.for([
  { reason: 'a macro on a receiver', lines: ['config.before_action :a'] },
  { reason: 'an after callback', lines: ['after_action :a', 'after_save :a'] },
  { reason: 'a validate of another name', lines: ['validate_group :a'] },
  { reason: 'a callback word inside a longer name', lines: ['not_before_action :a'] },
  { reason: 'a callback word opening a longer name', lines: ['around_action_log :a'] },
  { reason: 'an if of its own', lines: ['if b', '  go', 'end'] },
  { reason: 'what a method holds', lines: ['def go', '  before_action :a', 'end'] },
  { reason: 'what a nested class holds', lines: ['class Other', '  validates :a', 'end'] },
  { reason: 'a bare word', lines: ['before_action'] },
])('$reason reads nothing on the class', ({ lines }) => {
  expect(shopDecisions(...lines)).toEqual([]);
});

test('nothing inside a macro reads', () => {
  expect(shopDecisions('before_create { validates :a }')?.map(({ kind }) => kind)).toEqual([
    'guard',
  ]);
});

test('a macro in a nested class reads on that class', () => {
  const symbols = railsReader.symbols?.(
    ['class Shop', '  class Other', '    validates :a', '  end', 'end'].join('\n'),
    'app/models/shop.rb',
  )?.symbols;
  expect(symbols?.find(({ name }) => name === 'Shop::Other')?.decisions).toEqual([
    { kind: 'guard', text: 'validates :a', depth: 0, line: 3, foundByName: true },
  ]);
});

test('a scope reads what its lambda decides', () => {
  const symbols = railsReader.symbols?.(
    ['class Shop', '  scope :a, -> { b ? c : d }', 'end'].join('\n'),
    'app/models/shop.rb',
  )?.symbols;
  expect(symbols?.find(({ name }) => name === 'self.a')?.decisions).toEqual([
    { kind: 'ternary', text: 'b ?', depth: 0, line: 2 },
  ]);
  expect(symbols?.find(({ name }) => name === 'Shop')?.decisions).toEqual([]);
});

const blindSpotsIn = (...lines: ReadonlyArray<string>) =>
  railsReader.symbols?.(lines.join('\n'), 'app/models/shop.rb')?.blindSpots;

test.for([
  { line: 'define_method(:a) { 1 }', name: 'define_method' },
  { line: 'def method_missing(name) = super', name: 'method_missing' },
  { line: 'def self.method_missing(name) = super', name: 'method_missing' },
  { line: 'send(:a)', name: 'send' },
  { line: 'order.public_send(:a)', name: 'public_send' },
  { line: 'Order.class_eval { a }', name: 'class_eval' },
  { line: 'order.instance_eval do a end', name: 'instance_eval' },
])('$line is a blind spot, $name', ({ line, name }) => {
  expect(blindSpotsIn(line)).toEqual([name]);
});

test('each name that hides logic is listed once, in the order the file first uses it, at any depth', () => {
  expect(
    blindSpotsIn(
      'class Shop',
      '  def charge',
      '    send(:a) if x',
      '    define_method(:b) { send(:c) }',
      '  end',
      'end',
    ),
  ).toEqual(['send', 'define_method']);
});

test.for([
  { reason: 'a name in a comment', line: '# send(:a)' },
  { reason: 'a name in a string', line: '"define_method"' },
  { reason: 'a local of that name', line: 'send = 1' },
  { reason: 'a method defined under a name that is only called', line: 'def send(a) = a' },
  { reason: 'any other call', line: 'order.map(&:send)' },
])('$reason is no blind spot', ({ line }) => {
  expect(blindSpotsIn(line)).toEqual([]);
});

test.for([
  {
    reason: 'a callback lost',
    before: ['before_action :a'],
    after: [],
    finding: {
      id: 'logic:removed:shop#Shop#before_action :a',
      level: 'look',
      title: 'class Shop lost a guard',
      detail: 'before_action :a (found by name)',
    },
  },
  {
    reason: 'a validation lost',
    before: ['validates :a, presence: true'],
    after: [],
    finding: {
      id: 'logic:removed:shop#Shop#validates :a, presence: true',
      level: 'look',
      title: 'class Shop lost a guard',
      detail: 'validates :a, presence: true (found by name)',
    },
  },
  {
    reason: 'a skip added',
    before: [],
    after: ['skip_before_action :a'],
    finding: {
      id: 'logic:changed:shop#Shop',
      level: 'info',
      title: 'class Shop changed its logic',
      detail: '1 added',
    },
  },
])('$reason on a class raises one finding at $finding.level', ({ before, after, finding }) => {
  const sideOf = (lines: ReadonlyArray<string>) => {
    const file = railsReader.symbols?.(['class Shop', ...lines, 'end'].join('\n'), 'shop.rb');
    if (file === undefined) throw new Error('read no symbols');
    return file;
  };
  const changes = symbolChanges({ before: sideOf(before), after: sideOf(after) });
  expect(
    symbolFindings({ files: [{ stack: 'shop', node: 'shop', ...changes }], nodes: [] }),
  ).toEqual([{ dimension: 'logic', target: 'shop', ...finding }]);
});
