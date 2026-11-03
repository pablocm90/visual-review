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
