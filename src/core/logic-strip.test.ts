import { expect, test } from 'vitest';
import type { LogicLine } from './logic-diff.ts';
import { countsOf, holdsFewChanges, isExit } from './logic-strip.ts';

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
