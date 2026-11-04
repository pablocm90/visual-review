import { expect, test } from 'vitest';
import type { Comment } from '../core/review.ts';
import { anchorKey, anchorName, anchorTarget, lineAnchor } from './anchors.ts';
import { highlightPatch } from './highlight-patch.ts';

const nodes = [
  { id: 'web', label: 'Web app', path: '' },
  { id: 'web/module/src', label: 'src', parent: 'web', path: 'web/src' },
  { id: 'web/module/src/cart', label: 'cart', parent: 'web/module/src', path: 'web/src/cart' },
  {
    id: 'web/file/src/cart/total.ts',
    label: 'total.ts',
    parent: 'web/module/src/cart',
    path: 'web/src/cart/total.ts',
  },
  { id: 'web/file/src/pay.ts', label: 'pay.ts', parent: 'web/module/src', path: 'web/src/pay.ts' },
];

const tests = [{ path: 'web/src/cart/total.test.ts', stack: 'web' }];

test('anchors of two kinds with one id string are kept apart', () => {
  expect(anchorKey({ kind: 'test', id: 'web/src/a.ts#x' })).not.toBe(
    anchorKey({ kind: 'symbol', id: 'web/src/a.ts#x' }),
  );
});

test.for<{ anchor: Comment['anchor']; name: string }>([
  { anchor: { kind: 'part', id: 'web/file/src/pay.ts' }, name: 'pay.ts' },
  { anchor: { kind: 'part', id: 'web/file/src/gone.ts' }, name: 'web/file/src/gone.ts' },
  {
    anchor: { kind: 'edge', id: 'web/file/src/pay.ts -> web/file/src/cart/total.ts' },
    name: 'pay.ts → total.ts',
  },
  {
    anchor: { kind: 'symbol', id: 'web/file/src/cart/total.ts#Cart.total' },
    name: 'Cart.total in total.ts',
  },
  {
    anchor: {
      kind: 'decision',
      id: 'web/file/src/cart/total.ts#Cart.#total#if (this.#open) return#2',
      text: 'if (this.#open) return',
    },
    name: 'if (this.#open) return',
  },
  {
    anchor: { kind: 'test', id: 'web/src/cart/total.test.ts#Cart › totals › adds tax' },
    name: 'adds tax',
  },
  {
    anchor: { kind: 'line', id: 'web/src/cart/total.ts@base:12', text: 'if (!open) return' },
    name: 'total.ts:12 "if (!open) return"',
  },
  {
    anchor: { kind: 'line', id: 'docs/a@b.md@head:3', text: 'Hello' },
    name: 'docs/a@b.md:3 "Hello"',
  },
  {
    anchor: { kind: 'line', id: 'web/src/cart/total.ts@head:7', text: '    return total;' },
    name: 'total.ts:7 "return total;"',
  },
])('a $anchor.kind anchor $anchor.id is named $name', ({ anchor, name }) => {
  expect(anchorName(anchor, nodes)).toBe(name);
});

test.for<{ anchor: Comment['anchor']; target: string | undefined }>([
  { anchor: { kind: 'part', id: 'web/file/src/pay.ts' }, target: 'web/file/src/pay.ts' },
  {
    anchor: { kind: 'edge', id: 'web/file/src/pay.ts -> web/file/src/cart/total.ts' },
    target: 'web/file/src/pay.ts -> web/file/src/cart/total.ts',
  },
  {
    anchor: { kind: 'symbol', id: 'web/file/src/cart/total.ts#Cart.total' },
    target: 'web/file/src/cart/total.ts',
  },
  {
    anchor: { kind: 'decision', id: 'web/file/src/cart/total.ts#Cart.total#a # b', text: 'a # b' },
    target: 'web/file/src/cart/total.ts',
  },
  {
    anchor: { kind: 'test', id: 'web/src/cart/total.test.ts#Cart › totals' },
    target: 'web/file/src/cart/total.ts',
  },
  { anchor: { kind: 'test', id: 'web/src/gone.test.ts#Cart' }, target: undefined },
  {
    anchor: { kind: 'line', id: 'web/src/cart/total.ts@head:4', text: 'return sum' },
    target: 'web/file/src/cart/total.ts',
  },
  { anchor: { kind: 'line', id: 'README.md@head:1', text: '# Shop' }, target: undefined },
])('a $anchor.kind anchor $anchor.id goes to $target', ({ anchor, target }) => {
  expect(anchorTarget(anchor, { nodes, tests })).toBe(target);
});

test("a patch's lines anchor on the side they read from, base when removed, else head, each quoting its code; a hunk's header and a note anchor on nothing", () => {
  const path = 'src/a.ts';
  const patch = [
    `--- a/${path}`,
    `+++ b/${path}`,
    '@@ -12,2 +40,2 @@ const a',
    '   const kept = 1;',
    '-if (!open) return;',
    '+if (!shut) return;',
    '\\ No newline at end of file',
  ].join('\n');

  expect(highlightPatch({ path, patch }).map(line => lineAnchor({ path, line }))).toStrictEqual([
    undefined,
    { kind: 'line', id: 'src/a.ts@head:40', text: '  const kept = 1;' },
    { kind: 'line', id: 'src/a.ts@base:13', text: 'if (!open) return;' },
    { kind: 'line', id: 'src/a.ts@head:41', text: 'if (!shut) return;' },
    undefined,
  ]);
});
