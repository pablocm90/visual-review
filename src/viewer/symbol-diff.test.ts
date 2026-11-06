import { expect, test } from 'vitest';
import { highlightPatch } from './highlight-patch.ts';
import { rowsOfSymbol } from './symbol-diff.ts';

const rowsOf = (...lines: readonly string[]) =>
  highlightPatch({ path: 'a.ts', patch: lines.join('\n') });

const shown = (rows: ReturnType<typeof rowsOfSymbol>) =>
  rows.map(row => row.prefix + row.pieces.map(piece => piece.text).join(''));

const TWO_FUNCTIONS = rowsOf(
  '@@ -1,7 +1,7 @@',
  ' function a() {',
  '-  return 1;',
  '+  return 2;',
  ' }',
  ' function b() {',
  '-  return 3;',
  '+  return 4;',
  ' }',
);

test('an edited symbol keeps its own lines of a hunk, the removed ones among them, and not its neighbour', () => {
  expect(
    shown(
      rowsOfSymbol({
        rows: TWO_FUNCTIONS,
        lines: { base: { start: 4, end: 6 }, head: { start: 4, end: 6 } },
      }),
    ),
  ).toStrictEqual(['@@ -1,7 +1,7 @@', ' function b() {', '-  return 3;', '+  return 4;', ' }']);
});

const REPLACED = rowsOf(
  '@@ -1,5 +1,5 @@',
  ' const kept = 1;',
  '-const gone = 2;',
  '-const alsoGone = 3;',
  '+const fresh = 4;',
  ' const last = 5;',
);

test.for([
  {
    claim: 'a removed symbol, its base lines',
    lines: { base: { start: 2, end: 2 } },
    expected: ['@@ -1,5 +1,5 @@', '-const gone = 2;'],
  },
  {
    claim: 'an added symbol, its head lines',
    lines: { head: { start: 2, end: 2 } },
    expected: ['@@ -1,5 +1,5 @@', '+const fresh = 4;'],
  },
])('$claim', ({ lines, expected }) => {
  expect(shown(rowsOfSymbol({ rows: REPLACED, lines }))).toStrictEqual(expected);
});

test('a hunk where the symbol has only context is left out, its header too', () => {
  const rows = rowsOf(
    '@@ -1,3 +1,3 @@',
    ' function long() {',
    '-  first();',
    '+  second();',
    '@@ -20,2 +20,3 @@',
    ' }',
    '+const next = 1;',
    ' const after = 2;',
  );

  expect(
    shown(
      rowsOfSymbol({ rows, lines: { base: { start: 1, end: 20 }, head: { start: 1, end: 20 } } }),
    ),
  ).toStrictEqual(['@@ -1,3 +1,3 @@', ' function long() {', '-  first();', '+  second();']);
});

const NO_NEWLINE = rowsOf(
  '@@ -1,2 +1,2 @@',
  '-const a = 1;',
  '\\ No newline at end of file',
  '+const a = 2;',
  ' const b = 3;',
  '\\ No newline at end of file',
);

test('a note on a line goes with that line', () => {
  expect(
    shown(rowsOfSymbol({ rows: NO_NEWLINE, lines: { base: { start: 1, end: 1 } } })),
  ).toStrictEqual(['@@ -1,2 +1,2 @@', '-const a = 1;', '\\ No newline at end of file']);
});
