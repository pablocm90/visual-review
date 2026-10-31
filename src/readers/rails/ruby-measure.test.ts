import { expect, test } from 'vitest';
import { measureRuby } from './ruby-measure.ts';

const source = (...lines: ReadonlyArray<string>) => lines.join('\n');

test("a Ruby file's lines are those holding code, not blank or comment ones, a heredoc counted per row", () => {
  const text = source(
    'class Shop',
    '  # a note',
    '',
    '  PAGE = <<~TEXT',
    '    one',
    '',
    '    three',
    '  TEXT',
    '=begin',
    'a block',
    '=end',
    '  def open = true # trailing',
    'end',
    '',
  );

  expect(measureRuby(text)?.lines).toBe(8);
});

const namesIn = (...lines: ReadonlyArray<string>) =>
  measureRuby(source(...lines))?.functions.map(({ name }) => name);

test('every def is a method, named as written after def; blocks, lambdas and class-body calls are none', () => {
  expect(
    namesIn(
      'class Shop',
      '  scope :open, -> { where(open: true) }',
      '  define_method(:dynamic) { 1 }',
      '  def open; end',
      '  def self.build = new',
      '  def close?',
      '    items.each { |item| item }',
      '    helper = -> { 1 }',
      '    def nested; end',
      '  end',
      '  class << self',
      '    def find(id) = id',
      '  end',
      '  class Error < StandardError',
      '    def message = "closed"',
      '  end',
      'end',
      'def top; end',
    ),
  ).toEqual(['open', 'self.build', 'close?', 'nested', 'find', 'message', 'top']);
});

const cyclomaticOf = (body: string) =>
  measureRuby(source('def f', body, 'end'))?.functions[0]?.cyclomatic;

test.for([
  { body: 'if a then b elsif c then d else e end', cyclomatic: 3 },
  { body: 'unless a then b end', cyclomatic: 2 },
  { body: 'b if a; b unless a', cyclomatic: 3 },
  { body: 'a ? b : c', cyclomatic: 2 },
  { body: 'while a do b end; until a do b end', cyclomatic: 3 },
  { body: 'b while a; b until a', cyclomatic: 3 },
  { body: 'for x in a do b end', cyclomatic: 2 },
  { body: 'case a when 1 then b when 2, 3 then c else d end', cyclomatic: 3 },
  { body: 'case a\nin [x] then b\nin { y: } then c\nend', cyclomatic: 3 },
  { body: 'begin; a; rescue A; b; rescue B; c; ensure; d; end', cyclomatic: 3 },
  { body: 'a rescue b', cyclomatic: 2 },
  { body: 'a && b and c; a || b or c; !a; a + b', cyclomatic: 5 },
  { body: 'a ||= b; a &&= b; a += b', cyclomatic: 3 },
  { body: 'a&.b; a.b', cyclomatic: 2 },
  { body: 'items.each { |item| return if item }', cyclomatic: 2 },
])('$body has cyclomatic $cyclomatic', ({ body, cyclomatic }) => {
  expect(cyclomaticOf(body)).toBe(cyclomatic);
});

test("a nested def's decisions are its own, not the def around it", () => {
  const measured = measureRuby(source('def outer', '  def inner', '    a if b', '  end', 'end'));

  expect(measured?.functions.map(each => each.cyclomatic)).toEqual([1, 2]);
});
