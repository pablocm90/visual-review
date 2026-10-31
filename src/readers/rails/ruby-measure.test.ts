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
