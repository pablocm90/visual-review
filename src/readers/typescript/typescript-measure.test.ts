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

const namesIn = (...lines: ReadonlyArray<string>) =>
  measureTypeScript(source(...lines), 'src/shop.ts').functions.map(({ name }) => name);

test('every function with a body is one, named by its declaration, key or the name it is assigned to', () => {
  expect(
    namesIn(
      'export function declared() {}',
      'export default function () {}',
      'function overloaded(a: string): void;',
      'abstract class Shop {',
      '  constructor() {}',
      '  open() {}',
      '  get size() { return 1; }',
      '  set size(value: number) {}',
      '  #secret() {}',
      '  static close = () => {};',
      '  #hidden = function () {};',
      '  abstract shut(): void;',
      '}',
      'const store = {',
      '  load() {},',
      '  save: function () {},',
      '};',
      'const arrow = () => 1;',
      'const expression = function inner() {};',
    ),
  ).toEqual([
    'declared',
    'default',
    'constructor',
    'open',
    'size',
    'size',
    '#secret',
    'close',
    '#hidden',
    'load',
    'save',
    'arrow',
    'expression',
  ]);
});

test('an anonymous function is no function of its own, a named one inside another is', () => {
  expect(
    namesIn(
      'function load(items: Array<number>) {',
      '  items.forEach(item => { save(item); });',
      '  const helper = () => {};',
      '}',
      'items.map(function (item) {});',
    ),
  ).toEqual(['load', 'helper']);
});
