import { expect, test } from 'vitest';
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
