import { expect, test } from 'vitest';
import { rustReader } from './reader.ts';

const decisionsIn = (...lines: ReadonlyArray<string>) =>
  rustReader
    .symbols?.(['fn charge() {', ...lines, '}'].join('\n'), 'src/shop.rs')
    ?.symbols.find(({ name }) => name === 'charge')?.decisions;

test('an if that returns first reads as a guard, on its own line', () => {
  expect(decisionsIn('go();', 'if c { return 1; }')).toEqual([
    { kind: 'guard', text: 'if c return', depth: 0, line: 3 },
  ]);
});

test('an if that does something before it returns is no guard', () => {
  expect(decisionsIn('if c { go(); return 1; }')?.map(({ kind }) => kind)).not.toContain('guard');
});
