import { expect, test } from 'vitest';
import type { LogicLine } from './logic-diff.ts';
import { stripOf } from './logic-strip.ts';

const line = (change: LogicLine['change'], kind: LogicLine['kind']): LogicLine => ({
  change,
  kind,
  depth: 0,
  line: 1,
});

test('a mark per line in source order, each with its change', () => {
  const { marks } = stripOf([
    line('removed', 'if'),
    line('same', 'loop'),
    line('changed', 'ternary'),
    line('moved', 'case'),
    line('added', 'logical'),
  ]);

  expect(marks.map(mark => mark.change)).toEqual(['removed', 'same', 'changed', 'moved', 'added']);
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
  expect(stripOf([line('changed', kind)]).marks[0]?.exit).toBe(exit);
});

test('an unchanged exit is marked as any unchanged decision, a flat dash', () => {
  expect(stripOf([line('same', 'guard')]).marks[0]?.exit).toBe(false);
});

test('it counts the decisions changed and, among them, the exits', () => {
  const { changed, exits } = stripOf([
    line('removed', 'guard'),
    line('same', 'return'),
    line('moved', 'throw'),
    line('added', 'if'),
    line('same', 'loop'),
  ]);

  expect({ changed, exits }).toEqual({ changed: 3, exits: 2 });
});
