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
