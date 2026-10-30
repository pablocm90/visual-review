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

test('test fns and the items of a cfg(test) module are not measured as functions', () => {
  const text = source(
    'fn kept() {}',
    '#[test]',
    '#[ignore]',
    'fn checks() {}',
    '#[tokio::test]',
    'async fn awaits() {}',
    '#[cfg(test)]',
    'mod tests { fn helper() {} }',
    'fn also_kept() {}',
  );

  expect(measureRust(text).functions.map(({ name }) => name)).toEqual(['kept', 'also_kept']);
});

const cyclomaticOf = (body: string) => measureRust(`fn f() { ${body} }`).functions[0]?.cyclomatic;

test.for([
  { body: 'if a {}', cyclomatic: 2 },
  { body: 'if a {} else if b {} else {}', cyclomatic: 3 },
  { body: 'while a {}', cyclomatic: 2 },
  { body: 'for i in a {}', cyclomatic: 2 },
  { body: 'loop {}', cyclomatic: 2 },
  { body: 'match a { 1 => {}, _ => {} }', cyclomatic: 3 },
  { body: 'a && b;', cyclomatic: 2 },
  { body: 'a || b;', cyclomatic: 2 },
  { body: 'a == b;', cyclomatic: 1 },
  { body: 'a?;', cyclomatic: 2 },
  { body: 'let g = |y| if y {};', cyclomatic: 2 },
  { body: 'fn g() { if a {} }', cyclomatic: 1 },
])('`$body` gives its fn cyclomatic $cyclomatic', ({ body, cyclomatic }) => {
  expect(cyclomaticOf(body)).toBe(cyclomatic);
});
