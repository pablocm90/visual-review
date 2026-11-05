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

test.for(['bail!("no");', 'anyhow::bail!("no")'])(
  'an if that opens with %s reads as a guard, found by name',
  exit => {
    expect(decisionsIn(`if c { ${exit} }`)).toEqual([
      { kind: 'guard', text: 'if c return', foundByName: true, depth: 0, line: 2 },
    ]);
  },
);

test('a macro of another name is no exit', () => {
  expect(decisionsIn('if c { log!("no"); }')?.map(({ kind }) => kind)).not.toContain('guard');
});

test('an if that returns first but has an else is no guard', () => {
  expect(decisionsIn('if c { return 1; } else { go(); }')?.map(({ kind }) => kind)).not.toContain(
    'guard',
  );
});
