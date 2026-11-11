import { expect, test } from 'vitest';
import type { DiffedEdge, DiffedNode, GraphDiff } from './diff-graphs.ts';
import { partLabels, readingOrder } from './reading-order.ts';

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

test('reads a file as soon as all it imports is read, before files later in id order', () => {
  const diff = diffOf(
    [file('d.ts'), file('c.ts'), file('b.ts'), file('a.ts')],
    [edge('a.ts', 'b.ts')],
  );
  expect(readingOrder(diff).parts).toEqual([
    'web/file/b.ts',
    'web/file/a.ts',
    'web/file/c.ts',
    'web/file/d.ts',
  ]);
});

test('reads a file only once everything it imports is read', () => {
  const diff = diffOf(
    [file('a.ts'), file('b.ts'), file('c.ts')],
    [edge('a.ts', 'b.ts'), edge('a.ts', 'c.ts')],
  );
  expect(readingOrder(diff).parts).toEqual(['web/file/b.ts', 'web/file/c.ts', 'web/file/a.ts']);
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

test('orders the modules of two crates, at any depth, by the edge between the crates', () => {
  const crate = (name: string): DiffedNode => ({
    id: `api/crate/${name}`,
    kind: 'package',
    label: name,
    path: `crates/${name}`,
    parent: 'api',
    state: 'modified',
  });
  const mod = (krate: string, name: string, parent = `api/crate/${krate}`): DiffedNode => ({
    id: `api/mod/${krate}/${name}`,
    kind: 'module',
    label: name,
    path: `crates/${krate}/src/${name}.rs`,
    parent,
    state: 'modified',
  });
  const diff: GraphDiff = {
    nodes: [
      { id: 'api', kind: 'stack', label: 'api', path: '', state: 'modified' },
      crate('app'),
      crate('domain'),
      mod('app', 'routes'),
      mod('app', 'state'),
      { ...mod('domain', 'model'), state: 'unchanged' },
      mod('domain', 'model/order', 'api/mod/domain/model'),
    ],
    edges: [{ from: 'api/crate/app', to: 'api/crate/domain', state: 'unchanged' }],
  };
  expect(readingOrder(diff)).toEqual({
    parts: ['api/mod/domain/model/order', 'api/mod/app/routes', 'api/mod/app/state'],
    cycles: [],
  });
});

const crateEdge = (from: string, to: string): DiffedEdge => ({
  from: `api/crate/${from}`,
  to: `api/crate/${to}`,
  state: 'unchanged',
});

const twoCrates = (
  modules: ReadonlyArray<DiffedNode>,
  edges: ReadonlyArray<DiffedEdge>,
): GraphDiff => ({
  nodes: [
    { id: 'api', kind: 'stack', label: 'api', path: '', state: 'modified' },
    ...['a', 'b'].map(
      (name): DiffedNode => ({
        id: `api/crate/${name}`,
        kind: 'package',
        label: name,
        path: `crates/${name}`,
        parent: 'api',
        state: 'modified',
      }),
    ),
    ...modules,
  ],
  edges,
});

const crateCycle = (modules: ReadonlyArray<DiffedNode>): GraphDiff =>
  twoCrates(modules, [crateEdge('a', 'b'), crateEdge('b', 'a')]);

const crateModule = (krate: string, name: string, state: DiffedNode['state'] = 'modified') => ({
  id: `api/mod/${krate}/${name}`,
  kind: 'module' as const,
  label: name,
  path: `crates/${krate}/src/${name}.rs`,
  parent: `api/crate/${krate}`,
  state,
});

test('reads the modules of two crates that depend on each other as one cycle, though two of them reach each other only through the other crate', () => {
  const diff = crateCycle([
    crateModule('a', 'one'),
    crateModule('a', 'two'),
    crateModule('b', 'three'),
  ]);
  expect(readingOrder(diff)).toEqual({
    parts: ['api/mod/a/one', 'api/mod/a/two', 'api/mod/b/three'],
    cycles: [['api/mod/a/one', 'api/mod/a/two', 'api/mod/b/three']],
  });
});

test('reads a removed module inside a crate cycle once, after the rest', () => {
  const diff = crateCycle([
    crateModule('a', 'one'),
    crateModule('a', 'two', 'removed'),
    crateModule('b', 'three'),
  ]);
  expect(readingOrder(diff).parts).toEqual(['api/mod/a/one', 'api/mod/b/three', 'api/mod/a/two']);
});

test('reads a modified crate whose modules are all unchanged as a part, ordered by its edges', () => {
  const diff = twoCrates(
    [crateModule('a', 'one'), crateModule('b', 'two', 'unchanged')],
    [crateEdge('a', 'b')],
  );
  expect(readingOrder(diff).parts).toEqual(['api/crate/b', 'api/mod/a/one']);
});

test('orders a thousand changed files without stalling', () => {
  const names = Array.from({ length: 1000 }, (_, index) => `f${String(index).padStart(4, '0')}.ts`);
  const diff = diffOf(
    names.map(name => file(name)),
    names
      .slice(1)
      .flatMap((name, index) => (index % 10 === 0 ? [] : [edge(name, names[index] ?? '')])),
  );
  expect(readingOrder(diff).parts).toHaveLength(1000);
});

test("a part's name in the reading order carries its boxes' names only while another part reads the same", () => {
  const nodes = [
    { id: 'rust', label: 'rust' },
    { id: 'rust/crate/graph', label: 'graph', parent: 'rust' },
    { id: 'rust/crate/engine', label: 'rust-engine', parent: 'rust' },
    { id: 'rust/mod/graph/lib.rs', label: 'lib.rs', parent: 'rust/crate/graph' },
    { id: 'rust/mod/graph/hops', label: 'hops', parent: 'rust/crate/graph' },
    { id: 'rust/mod/engine/lib.rs', label: 'lib.rs', parent: 'rust/crate/engine' },
  ];
  const labels = partLabels(nodes, [
    'rust/mod/graph/lib.rs',
    'rust/mod/graph/hops',
    'rust/mod/engine/lib.rs',
  ]);
  expect([...labels.values()]).toStrictEqual(['graph › lib.rs', 'hops', 'rust-engine › lib.rs']);
});
