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
  { reason: 'a raise sent to another object', lines: ['log.raise Foo if y'] },
  { reason: 'an if with an else', lines: ['if x', '  return', 'else', '  go', 'end'] },
  { reason: 'an if opening with something else', lines: ['if x', '  go', '  return', 'end'] },
])('$reason is no guard', ({ lines }) => {
  expect(decisionsIn(...lines)?.filter(({ kind }) => kind === 'guard')).toEqual([]);
});
