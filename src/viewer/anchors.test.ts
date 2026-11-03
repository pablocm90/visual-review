import { expect, test } from 'vitest';
import type { Comment } from '../core/review.ts';
import { anchorKey, anchorName, anchorTarget } from './anchors.ts';

const nodes = [
  { id: 'web', label: 'Web app', path: '' },
  { id: 'web/module/src', label: 'src', path: 'web/src' },
  { id: 'web/module/src/cart', label: 'cart', path: 'web/src/cart' },
  { id: 'web/file/src/cart/total.ts', label: 'total.ts', path: 'web/src/cart/total.ts' },
  { id: 'web/file/src/pay.ts', label: 'pay.ts', path: 'web/src/pay.ts' },
];

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
    anchor: { kind: 'decision', id: 'web/file/src/cart/total.ts#Cart.total#if (!open) return' },
    name: 'if (!open) return',
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
    anchor: { kind: 'decision', id: 'web/file/src/cart/total.ts#Cart.total#a # b' },
    target: 'web/file/src/cart/total.ts',
  },
  {
    anchor: { kind: 'test', id: 'web/src/cart/total.test.ts#Cart › totals' },
    target: 'web/module/src/cart',
  },
  {
    anchor: { kind: 'line', id: 'web/src/cart/total.ts@head:4', text: 'return sum' },
    target: 'web/file/src/cart/total.ts',
  },
  { anchor: { kind: 'line', id: 'README.md@head:1', text: '# Shop' }, target: undefined },
])('a $anchor.kind anchor $anchor.id goes to $target', ({ anchor, target }) => {
  expect(anchorTarget(anchor, nodes)).toBe(target);
});
