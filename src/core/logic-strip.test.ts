import { expect, test } from 'vitest';
import type { LogicLine } from './logic-diff.ts';
import {
  countsOf,
  holdsFewChanges,
  isExit,
  logicTotalsOf,
  nodesWithChangedLogic,
  runsOf,
} from './logic-strip.ts';

const line = (change: LogicLine['change'], kind: LogicLine['kind']): LogicLine => ({
  change,
  kind,
  depth: 0,
  line: 1,
});

test.for([
  { kind: 'guard', exit: true },
  { kind: 'return', exit: true },
  { kind: 'throw', exit: true },
  { kind: 'catch', exit: true },
  { kind: 'if', exit: false },
  { kind: 'ternary', exit: false },
  { kind: 'loop', exit: false },
  { kind: 'case', exit: false },
  { kind: 'logical', exit: false },
  { kind: 'try', exit: false },
] as const)('a changed $kind is an exit: $exit', ({ kind, exit }) => {
  expect(isExit(line('changed', kind))).toBe(exit);
});

test('an unchanged exit is marked as any unchanged decision, a flat dash', () => {
  expect(isExit(line('same', 'guard'))).toBe(false);
});

test('it counts the decisions changed and, among them, the exits', () => {
  expect(
    countsOf([
      line('removed', 'guard'),
      line('same', 'return'),
      line('moved', 'throw'),
      line('added', 'if'),
      line('same', 'loop'),
    ]),
  ).toEqual({ changed: 3, exits: 2 });
});

test.for([
  { changes: 8, few: true },
  { changes: 9, few: false },
])(
  'a file of $changes changed decisions over two functions holds few: $few',
  ({ changes, few }) => {
    const first = Array.from({ length: 4 }, () => line('added', 'if'));
    const second = Array.from({ length: changes - 4 }, () => line('removed', 'if'));

    expect(
      holdsFewChanges([
        { logic: first },
        { logic: [line('same', 'if'), line('same', 'loop'), ...second] },
        {},
      ]),
    ).toBe(few);
  },
);

test('rows split into runs of changed and runs of unchanged, order kept, each row once', () => {
  const rowOf = (change: LogicLine['change'], id: string) => ({ line: line(change, 'if'), id });

  expect(
    runsOf([
      rowOf('same', 'a'),
      rowOf('added', 'b'),
      rowOf('removed', 'c'),
      rowOf('same', 'd'),
      rowOf('same', 'e'),
      rowOf('moved', 'f'),
    ]).map(({ unchanged, rows }) => [unchanged, rows.map(({ id }) => id)]),
  ).toEqual([
    [true, ['a']],
    [false, ['b', 'c']],
    [true, ['d', 'e']],
    [false, ['f']],
  ]);
});

test('the nodes with a changed decision: same lines, no logic and unreadable files hold none', () => {
  const fileOf = (node: string, logics: ReadonlyArray<ReadonlyArray<LogicLine> | undefined>) => ({
    node,
    symbols: logics.map(logic => (logic === undefined ? {} : { logic })),
  });

  expect(
    nodesWithChangedLogic([
      fileOf('only-same', [[line('same', 'if')]]),
      fileOf('second-symbol', [undefined, [line('same', 'if'), line('removed', 'guard')]]),
      { node: 'unreadable', unreadable: 'parse error' },
      fileOf('no-logic', [undefined]),
      fileOf('moved', [[line('moved', 'if')]]),
    ]),
  ).toEqual(['second-symbol', 'moved']);
});

test('the totals count the changed decisions by change and exit, the functions and files holding one', () => {
  expect(
    logicTotalsOf([
      {
        node: 'refund',
        symbols: [
          { logic: [line('added', 'guard'), line('added', 'if'), line('same', 'guard')] },
          { logic: [line('same', 'if')] },
          {},
          {
            logic: [
              line('removed', 'throw'),
              line('removed', 'if'),
              line('removed', 'if'),
              line('moved', 'if'),
              line('moved', 'if'),
              line('moved', 'if'),
              line('moved', 'if'),
            ],
          },
        ],
      },
      { node: 'cart', symbols: [{ logic: [line('changed', 'loop')] }] },
      { node: 'styles', symbols: [{ logic: [line('same', 'if')] }] },
      { node: 'broken', unreadable: 'Unexpected token' },
    ]),
  ).toEqual({
    decisions: 10,
    functions: 3,
    files: 2,
    exits: 2,
    added: 2,
    changed: 1,
    removed: 3,
    moved: 4,
  });
});
