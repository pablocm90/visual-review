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
  {
    path: 'src/shop.service.ts',
    text: '@Injectable() class Shop { constructor(@Inject(Db) db: Db) {} accessor open = true; }',
  },
  { path: 'src/view.tsx', text: '@observer class View { render = (n: number) => <b>{n}</b>; }' },
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
      'module.exports.handler = async () => {};',
      'const cast = (() => {}) as unknown as Handler;',
      'const checked = (() => {}) satisfies Handler;',
      'const sure = (() => {})!;',
      'const old = <Handler>(() => {});',
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
    'module.exports.handler',
    'cast',
    'checked',
    'sure',
    'old',
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

const cyclomaticOf = (body: string, params = '') =>
  measureTypeScript(`function f(${params}) { ${body} }`, 'src/shop.ts').functions[0]?.cyclomatic;

test.for([
  { body: 'if (a) {}', cyclomatic: 2 },
  { body: 'a ? b : c;', cyclomatic: 2 },
  { body: 'for (;;) {}', cyclomatic: 2 },
  { body: 'for (const k in a) {}', cyclomatic: 2 },
  { body: 'for (const v of a) {}', cyclomatic: 2 },
  { body: 'while (a) {}', cyclomatic: 2 },
  { body: 'do {} while (a);', cyclomatic: 2 },
  { body: 'switch (a) { case 1: break; case 2: break; default: }', cyclomatic: 3 },
  { body: 'try {} catch {}', cyclomatic: 2 },
  { body: 'try {} finally {}', cyclomatic: 1 },
  { body: 'a && b; a || b; a ?? b;', cyclomatic: 4 },
  { body: 'a &&= b; a ||= b; a ??= b;', cyclomatic: 4 },
  { body: 'a = b; a += b;', cyclomatic: 1 },
  { body: 'a?.b.c; a?.(); a?.[0];', cyclomatic: 4 },
  { body: 'a === b;', cyclomatic: 1 },
  { body: '', params: 'a = 1, b', cyclomatic: 2 },
  { body: 'let c: { d?: number };', params: 'a?: number', cyclomatic: 1 },
  { body: 'items.forEach(item => { if (item) {} });', cyclomatic: 2 },
  { body: 'const g = () => { if (a) {} };', cyclomatic: 1 },
])('`$body` gives its function cyclomatic $cyclomatic', ({ body, params, cyclomatic }) => {
  expect(cyclomaticOf(body, params)).toBe(cyclomatic);
});

const abcOf = (body: string) =>
  measureTypeScript(`function f() { ${body} }`, 'src/shop.ts').functions[0]?.abc;

test.for([
  { body: 'const a = 1;', abc: [1, 0, 0] },
  { body: 'let a;', abc: [0, 0, 0] },
  { body: 'a = 1; a += 1; a ??= 1;', abc: [3, 0, 0] },
  { body: 'a++; --a;', abc: [2, 0, 0] },
  { body: 'g(); a.g(); a?.g();', abc: [0, 3, 1] },
  { body: 'new Shop();', abc: [0, 1, 0] },
  { body: 'a == b; a != b; a === b; a !== b; a < b; a > b; a <= b; a >= b;', abc: [0, 0, 8] },
  { body: 'a + b; a && b;', abc: [0, 0, 0] },
  { body: 'if (a) {} else {} if (b) {}', abc: [0, 0, 1] },
  { body: 'switch (a) { case 1: break; default: }', abc: [0, 0, 2] },
  { body: 'try {} catch {}', abc: [0, 0, 1] },
  { body: 'a ? b : c;', abc: [0, 0, 1] },
  { body: 'a?.b;', abc: [0, 0, 1] },
  { body: 'items.forEach(item => { a = item; });', abc: [1, 1, 0] },
  { body: 'const g = () => h();', abc: [1, 0, 0] },
])('`$body` gives its function ABC $abc', ({ body, abc: [assignments, branches, conditions] }) => {
  expect(abcOf(body)).toEqual({ assignments, branches, conditions });
});
