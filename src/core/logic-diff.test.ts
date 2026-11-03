import { expect, test } from 'vitest';
import { logicDiff } from './logic-diff.ts';
import type { Decision } from './reader.ts';

const decision = (overrides: Partial<Decision> & Pick<Decision, 'text'>): Decision => ({
  kind: 'if',
  depth: 0,
  line: 1,
  ...overrides,
});

test('decisions kept in order are the same, and the rest added or removed, on their own side', () => {
  expect(
    logicDiff({
      base: [
        decision({ kind: 'guard', text: 'if (!order) return', line: 2 }),
        decision({ text: 'if (order.paid)', line: 3 }),
        decision({ kind: 'catch', text: 'catch (error)', depth: 1, line: 5 }),
      ],
      head: [
        decision({ text: 'if (order.paid)', line: 2 }),
        decision({ kind: 'loop', text: 'for (const item of order.items)', depth: 1, line: 3 }),
      ],
    }),
  ).toEqual([
    { change: 'removed', kind: 'guard', depth: 0, base: 'if (!order) return', line: 2 },
    { change: 'same', kind: 'if', depth: 0, head: 'if (order.paid)', line: 2 },
    { change: 'removed', kind: 'catch', depth: 1, base: 'catch (error)', line: 5 },
    {
      change: 'added',
      kind: 'loop',
      depth: 1,
      head: 'for (const item of order.items)',
      line: 3,
    },
  ]);
});

test('a decision wrapped in a new if is the same, at its new depth, under one added if', () => {
  expect(
    logicDiff({
      base: [
        decision({ kind: 'loop', text: 'while (order.open)', line: 2 }),
        decision({ kind: 'return', text: 'return', depth: 1, line: 3 }),
      ],
      head: [
        decision({ text: 'if (order.ready)', line: 2 }),
        decision({ kind: 'loop', text: 'while (order.open)', depth: 1, line: 3 }),
        decision({ kind: 'return', text: 'return', depth: 2, line: 4 }),
      ],
    }).map(({ change, depth, line }) => `${change} ${depth} ${line}`),
  ).toEqual(['added 0 2', 'same 1 3', 'same 2 4']);
});

test('a decision of the same text but another kind is not the same', () => {
  expect(
    logicDiff({
      base: [decision({ kind: 'guard', text: 'if (order.paid)' })],
      head: [decision({ kind: 'if', text: 'if (order.paid)' })],
    }).map(({ change, kind }) => `${change} ${kind}`),
  ).toEqual(['removed guard', 'added if']);
});

const ifs = (...tests: ReadonlyArray<string>) =>
  tests.map((test, index) => decision({ text: `if (${test})`, line: index + 1 }));

const marked = (lines: ReadonlyArray<{ change: string; base?: string; head?: string }>) =>
  lines.map(({ change, base, head }) => `${change} ${head ?? base}`);

test('the most decisions are kept the same, whichever side moved', () => {
  expect(
    marked(logicDiff({ base: ifs('x', 'a', 'b', 'c'), head: ifs('a', 'b', 'c', 'x') })),
  ).toEqual(['removed if (x)', 'same if (a)', 'same if (b)', 'same if (c)', 'added if (x)']);
  expect(
    marked(logicDiff({ base: ifs('a', 'b', 'c', 'x'), head: ifs('x', 'a', 'b', 'c') })),
  ).toEqual(['added if (x)', 'same if (a)', 'same if (b)', 'same if (c)', 'removed if (x)']);
  expect(marked(logicDiff({ base: ifs('a', 'b', 'c', 'a'), head: ifs('c', 'a') }))).toEqual([
    'removed if (a)',
    'removed if (b)',
    'same if (c)',
    'same if (a)',
  ]);
});

test('of two decisions that swapped places, the first of the base is the one that moved', () => {
  expect(marked(logicDiff({ base: ifs('a', 'b'), head: ifs('b', 'a') }))).toEqual([
    'removed if (a)',
    'same if (b)',
    'added if (a)',
  ]);
});

test('a run of decisions added or removed keeps the ones after it the same', () => {
  expect(marked(logicDiff({ base: ifs('a', 'c'), head: ifs('x', 'y', 'a', 'c') }))).toEqual([
    'added if (x)',
    'added if (y)',
    'same if (a)',
    'same if (c)',
  ]);
  expect(marked(logicDiff({ base: ifs('x', 'y', 'a', 'c'), head: ifs('a', 'c') }))).toEqual([
    'removed if (x)',
    'removed if (y)',
    'same if (a)',
    'same if (c)',
  ]);
});

test('a decision whose text changed, between the same ones, is changed, at its head depth and line', () => {
  expect(
    logicDiff({
      base: [
        decision({ kind: 'catch', text: 'catch (error)', line: 2 }),
        decision({ text: 'if (amount > 0)', depth: 1, line: 3 }),
      ],
      head: [
        decision({ kind: 'catch', text: 'catch (error)', line: 2 }),
        decision({ text: 'if (amount >= 0)', depth: 2, line: 4 }),
      ],
    })[1],
  ).toEqual({
    change: 'changed',
    kind: 'if',
    depth: 2,
    base: 'if (amount > 0)',
    head: 'if (amount >= 0)',
    line: 4,
  });
});

test('in a gap, decisions of a kind pair in order and the rest of the base are removed', () => {
  expect(
    marked(
      logicDiff({
        base: [
          decision({ kind: 'guard', text: 'if (!order) return' }),
          ...ifs('a', 'b'),
          decision({ kind: 'loop', text: 'while (open)' }),
        ],
        head: [decision({ kind: 'catch', text: 'catch' }), ...ifs('c')],
      }),
    ),
  ).toEqual([
    'removed if (!order) return',
    'removed if (b)',
    'removed while (open)',
    'added catch',
    'changed if (c)',
  ]);
});

test('decisions that differ only in the whitespace between their tokens are the same; whitespace between two words or inside a string still counts', () => {
  expect(
    logicDiff({
      base: [
        decision({ text: 'if (a>0)' }),
        decision({ text: 'if (key in order)' }),
        decision({ text: "if (name === 'a b')" }),
      ],
      head: [
        decision({ text: 'if (a > 0)' }),
        decision({ text: 'if (keyin order)' }),
        decision({ text: "if (name === 'ab')" }),
      ],
    }).map(({ change, base, head }) => [change, base ?? head]),
  ).toEqual([
    ['same', 'if (a > 0)'],
    ['changed', 'if (key in order)'],
    ['changed', "if (name === 'a b')"],
  ]);
});
