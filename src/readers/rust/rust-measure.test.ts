import { expect, test } from 'vitest';
import { measureRust } from './rust-measure.ts';

const source = (...lines: ReadonlyArray<string>) => lines.join('\n');

test("a Rust file's lines are those holding code, not blank or comment ones", () => {
  const text = source(
    'fn a() {',
    '    // a note',
    '',
    '    let s = "one',
    'two',
    'three"; // trailing',
    '    /* a block',
    '    */',
    '}',
    '',
  );

  expect(measureRust(text).lines).toBe(5);
});

const noAbc = { assignments: 0, branches: 0, conditions: 0 };

test('every fn with a body is a function, free, in an impl, a trait default or nested, and a straight one has cyclomatic 1', () => {
  const text = source(
    'fn free() {',
    '    fn nested() {}',
    '}',
    'impl Shop { fn open(&self) {} }',
    'trait Store { fn close(&self); fn shut(&self) {} }',
  );

  expect(measureRust(text).functions).toEqual([
    { name: 'free', cyclomatic: 1, abc: noAbc },
    { name: 'nested', cyclomatic: 1, abc: noAbc },
    { name: 'open', cyclomatic: 1, abc: noAbc },
    { name: 'shut', cyclomatic: 1, abc: noAbc },
  ]);
});
