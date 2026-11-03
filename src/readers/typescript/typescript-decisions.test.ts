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
  expect(decisionsOf('keep', ...lines)?.map(({ text }) => text)).toEqual(['if (item.kept) return']);
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

const kindsAndTexts = (name: string, ...lines: ReadonlyArray<string>) =>
  decisionsOf(name, ...lines)?.map(({ kind, text }) => `${kind}: ${text}`);

test('an if that only returns, with no else, is a guard', () => {
  expect(
    kindsAndTexts(
      'charge',
      'function charge(order) {',
      '  if (!order) return;',
      '  if (order.free) { return 0; }',
      '  if (order.paid) return order.total; else pay();',
      '  if (order.open) { pay(); return 1; }',
      '}',
    ),
  ).toEqual([
    'guard: if (!order) return',
    'guard: if (order.free) return',
    'if: if (order.paid)',
    'if: if (order.open)',
  ]);
});

test('a throw is a decision, named by the class it throws; an if that only throws is a guard', () => {
  expect(
    kindsAndTexts(
      'charge',
      'function charge(order) {',
      "  if (!order) throw new MissingOrder('none');",
      '  if (order.void) { throw new errors.Void(order.id); }',
      '  try { pay(); } catch (error) { throw error; }',
      '}',
    ),
  ).toEqual([
    'guard: if (!order) throw new MissingOrder',
    'guard: if (order.void) throw new errors.Void',
    'catch: catch (error)',
    'throw: throw error',
  ]);
});

test.for([
  {
    reason: 'a catch, by its parameter if it has one',
    body: ['try { pay(); } catch (error) { log(error); }', 'try { pay(); } catch { log(); }'],
    decisions: ['catch: catch (error)', 'catch: catch'],
  },
])('$reason is a decision', ({ body, decisions }) => {
  expect(kindsAndTexts('charge', 'function charge(order) {', ...body, '}')).toEqual(decisions);
});
