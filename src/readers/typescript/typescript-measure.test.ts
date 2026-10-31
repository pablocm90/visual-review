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

  expect(measureTypeScript(text, 'src/shop.ts').lines).toBe(6);
});

test.for([
  { path: 'src/cast.ts', text: 'const n = <number>value;' },
  { path: 'src/cast.cts', text: 'const n = <number>value;' },
  { path: 'src/view.tsx', text: 'const view = (n: number) => <b>{n}</b>;' },
  { path: 'src/view.js', text: 'const view = n => <b>{n}</b>;' },
  { path: 'src/view.mjs', text: 'const view = n => <b>{n}</b>;' },
])('$path parses with the syntax its extension allows', ({ path, text }) => {
  expect(measureTypeScript(text, path).lines).toBe(1);
});
