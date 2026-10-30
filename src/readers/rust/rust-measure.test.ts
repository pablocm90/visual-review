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
