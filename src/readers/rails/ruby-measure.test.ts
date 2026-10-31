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
