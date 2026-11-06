import { expect, test } from 'vitest';
import { highlightPatch } from './highlight-patch.ts';
import { holdsFirstLine, rowsOfSymbol } from './symbol-diff.ts';

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
        inFile: [],
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
  expect(shown(rowsOfSymbol({ rows: REPLACED, lines, inFile: [] }))).toStrictEqual(expected);
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
      rowsOfSymbol({
        rows,
        lines: { base: { start: 1, end: 20 }, head: { start: 1, end: 20 } },
        inFile: [],
      }),
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
    shown(rowsOfSymbol({ rows: NO_NEWLINE, lines: { base: { start: 1, end: 1 } }, inFile: [] })),
  ).toStrictEqual(['@@ -1,2 +1,2 @@', '-const a = 1;', '\\ No newline at end of file']);
});

const A_CLASS = rowsOf(
  '@@ -1,9 +1,6 @@',
  ' class Box {',
  '-  size = 1;',
  '+  size = 2;',
  '   open() {',
  '-    return 1;',
  '+    return 2;',
  '   }',
  '-  shut() {',
  '-    return 3;',
  '-  }',
  ' }',
  '+const after = 1;',
);
const BOX = { base: { start: 1, end: 9 }, head: { start: 1, end: 6 } };
const OPEN = { base: { start: 3, end: 5 }, head: { start: 3, end: 5 } };
const SHUT = { base: { start: 6, end: 8 } };

test('a symbol leaves out the lines of the symbols inside it', () => {
  expect(
    shown(
      rowsOfSymbol({
        rows: A_CLASS,
        lines: BOX,
        inFile: [{ lines: BOX }, { lines: OPEN }, { lines: SHUT }],
      }),
    ),
  ).toStrictEqual(['@@ -1,9 +1,6 @@', ' class Box {', '-  size = 1;', '+  size = 2;', ' }']);
});

test('a symbol inside another keeps its own lines', () => {
  expect(
    shown(
      rowsOfSymbol({
        rows: A_CLASS,
        lines: OPEN,
        inFile: [{ lines: BOX }, { lines: OPEN }, { lines: SHUT }],
      }),
    ),
  ).toStrictEqual(['@@ -1,9 +1,6 @@', '   open() {', '-    return 1;', '+    return 2;', '   }']);
});

test('symbols sharing one range all keep its lines', () => {
  const rows = rowsOf('@@ -1 +1 @@', '-attr_reader :a', '+attr_reader :a, :b');
  const lines = { base: { start: 1, end: 1 }, head: { start: 1, end: 1 } };

  expect(shown(rowsOfSymbol({ rows, lines, inFile: [{ lines }, { lines }] }))).toStrictEqual([
    '@@ -1 +1 @@',
    '-attr_reader :a',
    '+attr_reader :a, :b',
  ]);
});

test.for([
  {
    claim: 'only on the head, an added method',
    rows: ['@@ -1,2 +1,4 @@', ' class Box {', '+  open() {', '+  }', ' }'],
    outer: { base: { start: 1, end: 2 }, head: { start: 1, end: 4 } },
    inner: { head: { start: 2, end: 3 } },
  },
  {
    claim: 'sharing its first line',
    rows: [
      '@@ -1,2 +1,2 @@',
      '-class Box { a() { return 1; }',
      '+class Box { a() { return 2; }',
      ' }',
    ],
    outer: { base: { start: 1, end: 2 }, head: { start: 1, end: 2 } },
    inner: { base: { start: 1, end: 1 }, head: { start: 1, end: 1 } },
  },
  {
    claim: 'sharing its last line',
    rows: ['@@ -1,2 +1,2 @@', ' class Box {', '-  a() { return 1; } }', '+  a() { return 2; } }'],
    outer: { base: { start: 1, end: 2 }, head: { start: 1, end: 2 } },
    inner: { base: { start: 2, end: 2 }, head: { start: 2, end: 2 } },
  },
])(
  'a symbol with no change of its own gets nothing, the one inside it $claim',
  ({ rows, outer, inner }) => {
    expect(
      rowsOfSymbol({ rows: rowsOf(...rows), lines: outer, inFile: [{ lines: inner }] }),
    ).toStrictEqual([]);
  },
);

test.for([
  {
    claim: 'a head row on its first head line',
    lines: { base: { start: 90, end: 99 }, head: { start: 2, end: 3 } },
    holds: true,
  },
  {
    claim: 'a base row on its first base line',
    lines: { base: { start: 2, end: 3 }, head: { start: 90, end: 99 } },
    holds: true,
  },
  {
    claim: 'rows that start after it',
    lines: { base: { start: 1, end: 3 }, head: { start: 1, end: 3 } },
    holds: false,
  },
  {
    claim: 'a removed symbol, no head line to match',
    lines: { base: { start: 1, end: 3 } },
    holds: false,
  },
])('holdsFirstLine: $claim', ({ lines, holds }) => {
  expect(holdsFirstLine({ rows: rowsOf('@@ -2,2 +2,2 @@', '-a', '+b', ' c'), lines })).toBe(holds);
});
