import { expect, test } from 'vitest';
import { measureTypeScript } from './typescript-measure.ts';

const source = (...lines: ReadonlyArray<string>) => lines.join('\n');

test("a TS file's lines are those holding code, not blank or comment ones, a template counted per row", () => {
  const text = source(
    'export const shop = () => {',
    '  // a note',
    '',
    '  const page = `one',
    '',
    'three`; // trailing',
    '  /* a block',
    '  */',
    '};',
    'export const two = 2;',
    '',
    '',
  );

  expect(measureTypeScript(text).lines).toBe(6);
});
