import { expect, test } from 'vitest';
import type { DiffedEdge, DiffedNode, GraphDiff } from './diff-graphs.ts';
import { readingOrder } from './reading-order.ts';

const file = (name: string, state: DiffedNode['state'] = 'modified'): DiffedNode => ({
  id: `web/file/${name}`,
  kind: 'file',
  label: name,
  path: `web/src/${name}`,
  parent: 'web',
  state,
});

const edge = (from: string, to: string, state: DiffedEdge['state'] = 'unchanged'): DiffedEdge => ({
  from: `web/file/${from}`,
  to: `web/file/${to}`,
  state,
});

const diffOf = (
  nodes: ReadonlyArray<DiffedNode>,
  edges: ReadonlyArray<DiffedEdge> = [],
): GraphDiff => ({
  nodes: [{ id: 'web', kind: 'stack', label: 'web', path: '', state: 'modified' }, ...nodes],
  edges,
});

test.for([
  { importer: 'a.ts', imported: 'b.ts' },
  { importer: 'b.ts', imported: 'a.ts' },
])('reads $importer after $imported, which it imports', ({ importer, imported }) => {
  const diff = diffOf([file('a.ts'), file('b.ts')], [edge(importer, imported)]);
  expect(readingOrder(diff).parts).toEqual([`web/file/${imported}`, `web/file/${importer}`]);
});

test('orders changed files through an unchanged one, which it leaves out', () => {
  const diff = diffOf(
    [file('a.ts'), file('x.ts', 'unchanged'), file('b.ts')],
    [edge('a.ts', 'x.ts'), edge('x.ts', 'b.ts')],
  );
  expect(readingOrder(diff).parts).toEqual(['web/file/b.ts', 'web/file/a.ts']);
});

test('reads files that import each other in id order, and says they do', () => {
  const diff = diffOf(
    [file('b.ts'), file('c.ts'), file('a.ts')],
    [edge('a.ts', 'b.ts'), edge('b.ts', 'a.ts'), edge('c.ts', 'a.ts')],
  );
  expect(readingOrder(diff)).toEqual({
    parts: ['web/file/a.ts', 'web/file/b.ts', 'web/file/c.ts'],
    cycles: [['web/file/a.ts', 'web/file/b.ts']],
  });
});

test('reads removed files after the files the head holds, in id order', () => {
  const diff = diffOf([file('b.ts', 'removed'), file('a.ts', 'removed'), file('c.ts')]);
  expect(readingOrder(diff).parts).toEqual(['web/file/c.ts', 'web/file/a.ts', 'web/file/b.ts']);
});

test('orders by the head graph, not by an import the change removed', () => {
  const diff = diffOf(
    [file('a.ts'), file('b.ts')],
    [edge('b.ts', 'a.ts', 'removed'), edge('a.ts', 'b.ts', 'added')],
  );
  expect(readingOrder(diff).parts).toEqual(['web/file/b.ts', 'web/file/a.ts']);
});
