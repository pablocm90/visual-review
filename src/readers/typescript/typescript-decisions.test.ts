import { expect, test } from 'vitest';
import { symbolsOfTypeScript } from './typescript-symbols.ts';

const source = (...lines: ReadonlyArray<string>) => lines.join('\n');

const decisionsOf = (name: string, ...lines: ReadonlyArray<string>) =>
  symbolsOfTypeScript(source(...lines), 'src/shop.ts').symbols.find(symbol => symbol.name === name)
    ?.decisions;

test("a function's ifs are decisions in source order, each with its test, its depth and its line", () => {
  expect(
    decisionsOf(
      'charge',
      'function charge(order) {',
      '  if (order.paid) {',
      '    if (order.refunded) log();',
      '  }',
      '  if (order.open) pay();',
      '}',
    ),
  ).toEqual([
    { kind: 'if', text: 'if (order.paid)', depth: 0, line: 2 },
    { kind: 'if', text: 'if (order.refunded)', depth: 1, line: 3 },
    { kind: 'if', text: 'if (order.open)', depth: 0, line: 5 },
  ]);
});

test("an inner function's decisions are its own, not its parent's, and a callback's are its parent's", () => {
  const lines = [
    'function load(items) {',
    '  const keep = item => { if (item.kept) return item; };',
    '  items.forEach(item => { if (item.open) log(); });',
    '}',
  ];
  expect(decisionsOf('load', ...lines)?.map(({ text }) => text)).toEqual(['if (item.open)']);
  expect(decisionsOf('keep', ...lines)?.map(({ text }) => text)).toEqual(['if (item.kept)']);
});

test('an else if sits at the depth of the if it follows, and what it holds one deeper', () => {
  expect(
    decisionsOf(
      'charge',
      'function charge(order) {',
      '  if (order.paid) pay();',
      '  else if (order.open) {',
      '    if (order.late) warn();',
      '  }',
      '}',
    )?.map(({ text, depth }) => `${depth} ${text}`),
  ).toEqual(['0 if (order.paid)', '0 if (order.open)', '1 if (order.late)']);
});
