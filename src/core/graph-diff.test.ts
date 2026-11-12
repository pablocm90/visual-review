import { expect, test } from 'vitest';
import { diffGraphs } from './diff-graphs.ts';
import type { Graph, GraphEdge, GraphNode } from './graph.ts';

const crate = (name: string): GraphNode => ({
  id: `rust/crate/${name}`,
  kind: 'package',
  label: name,
  parent: 'rust',
  path: `crates/${name}`,
});

const rootFile = (name: string): GraphNode => ({
  id: `web/file/${name}`,
  kind: 'file',
  label: name,
  parent: 'web',
  path: `web/src/${name}`,
});

const dependency = (from: string, to: string): GraphEdge => ({
  from: `rust/crate/${from}`,
  to: `rust/crate/${to}`,
});

const graph = (overrides: Partial<Graph> = {}): Graph => ({
  nodes: [crate('domain'), crate('application')],
  edges: [dependency('application', 'domain')],
  ...overrides,
});

test('a crate with a changed file under its directory is modified, but not a crate whose directory name only prefixes it', () => {
  const crates = graph({ nodes: [crate('app'), crate('application')] });

  const diff = diffGraphs({
    renames: [],
    before: crates,
    after: crates,
    changedPaths: ['crates/application/src/lib.rs'],
  });

  expect(diff.nodes).toEqual([
    { ...crate('app'), state: 'unchanged' },
    { ...crate('application'), state: 'modified' },
  ]);
});

test('a changed file node is modified, but not a file whose name only prefixes it', () => {
  const files = graph({ nodes: [rootFile('main.ts'), rootFile('main.tsx')] });

  const diff = diffGraphs({
    renames: [],
    before: files,
    after: files,
    changedPaths: ['web/src/main.tsx'],
  });

  expect(diff.nodes).toEqual([
    { ...rootFile('main.ts'), state: 'unchanged' },
    { ...rootFile('main.tsx'), state: 'modified' },
  ]);
});

test('a crate only in the after graph is added, even though its files changed', () => {
  const diff = diffGraphs({
    renames: [],
    before: graph({ nodes: [crate('domain')] }),
    after: graph({ nodes: [crate('domain'), crate('cli-adapter')] }),
    changedPaths: ['crates/cli-adapter/src/main.rs'],
  });

  expect(diff.nodes).toEqual([
    { ...crate('domain'), state: 'unchanged' },
    { ...crate('cli-adapter'), state: 'added' },
  ]);
});

test('an edge matches only on both ends, so a reversed dependency is one removed and one added edge', () => {
  const diff = diffGraphs({
    renames: [],
    before: graph({
      edges: [dependency('application', 'domain'), dependency('http-adapter', 'application')],
    }),
    after: graph({
      edges: [
        dependency('application', 'domain'),
        dependency('application', 'http-adapter'),
        dependency('cli-adapter', 'domain'),
      ],
    }),
    changedPaths: [],
  });

  expect(diff.edges).toEqual([
    { ...dependency('application', 'domain'), state: 'unchanged' },
    { ...dependency('application', 'http-adapter'), state: 'added' },
    { ...dependency('cli-adapter', 'domain'), state: 'added' },
    { ...dependency('http-adapter', 'application'), state: 'removed' },
  ]);
});

test('a crate only in the before graph is kept as removed', () => {
  const diff = diffGraphs({
    renames: [],
    before: graph({ nodes: [crate('domain'), crate('legacy')] }),
    after: graph({ nodes: [crate('domain')] }),
    changedPaths: [],
  });

  expect(diff.nodes).toEqual([
    { ...crate('domain'), state: 'unchanged' },
    { ...crate('legacy'), state: 'removed' },
  ]);
});

test('a renamed file is one modified node, renamed from its old path and label, that keeps its imports', () => {
  const importOf = (from: string, to: string): GraphEdge => ({
    from: `web/file/${from}`,
    to: `web/file/${to}`,
  });

  const diff = diffGraphs({
    before: { nodes: [rootFile('b.ts'), rootFile('old.ts')], edges: [importOf('b.ts', 'old.ts')] },
    after: { nodes: [rootFile('b.ts'), rootFile('new.ts')], edges: [importOf('b.ts', 'new.ts')] },
    changedPaths: ['web/src/new.ts', 'web/src/old.ts'],
    renames: [{ from: 'web/src/old.ts', to: 'web/src/new.ts' }],
  });

  expect(diff).toStrictEqual({
    nodes: [
      { ...rootFile('b.ts'), state: 'unchanged' },
      {
        ...rootFile('new.ts'),
        state: 'modified',
        renamedFrom: 'web/src/old.ts',
        formerLabel: 'old.ts',
      },
    ],
    edges: [{ ...importOf('b.ts', 'new.ts'), state: 'unchanged' }],
  });
});

test('a crate whose directory moved is one node, renamed from its old path and label, that keeps its dependencies and files', () => {
  const libOf = (name: string): GraphNode => ({
    id: `rust/mod/${name}/lib.rs`,
    kind: 'file',
    label: 'lib.rs',
    parent: `rust/crate/${name}`,
    path: `crates/${name}/src/lib.rs`,
  });

  const diff = diffGraphs({
    before: graph({ nodes: [crate('application'), crate('domain'), libOf('domain')] }),
    after: graph({
      nodes: [crate('application'), crate('models'), libOf('models')],
      edges: [dependency('application', 'models')],
    }),
    changedPaths: ['crates/domain/src/lib.rs', 'crates/models/src/lib.rs'],
    renames: [{ from: 'crates/domain/src/lib.rs', to: 'crates/models/src/lib.rs' }],
  });

  expect(diff).toStrictEqual({
    nodes: [
      { ...crate('application'), state: 'unchanged' },
      {
        ...crate('models'),
        state: 'modified',
        renamedFrom: 'crates/domain',
        formerLabel: 'domain',
      },
      { ...libOf('models'), state: 'modified', renamedFrom: 'crates/domain/src/lib.rs' },
    ],
    edges: [{ ...dependency('application', 'models'), state: 'unchanged' }],
  });
});

test('a crate renamed in place, in the same directory, is one node with its former label', () => {
  const diff = diffGraphs({
    before: graph({ nodes: [crate('domain')], edges: [] }),
    after: graph({ nodes: [{ ...crate('models'), path: 'crates/domain' }], edges: [] }),
    changedPaths: ['crates/domain/Cargo.toml'],
    renames: [],
  });

  expect(diff.nodes).toStrictEqual([
    { ...crate('models'), path: 'crates/domain', state: 'modified', formerLabel: 'domain' },
  ]);
});

test('a removed stack and an added one are two stacks, though no stack has a path of its own', () => {
  const stack = (id: string): GraphNode => ({ id, kind: 'stack', label: id, path: '' });
  const diff = diffGraphs({
    before: { nodes: [stack('apps/old')], edges: [] },
    after: { nodes: [stack('apps/new')], edges: [] },
    changedPaths: [],
    renames: [],
  });

  expect(diff.nodes).toStrictEqual([
    { ...stack('apps/new'), state: 'added' },
    { ...stack('apps/old'), state: 'removed' },
  ]);
});

test('a removed crate pairs with the added crate that more than half of its files went to', () => {
  const renames = [
    { from: 'crates/domain/src/money.rs', to: 'crates/shared/src/money.rs' },
    { from: 'crates/domain/Cargo.toml', to: 'crates/models/Cargo.toml' },
    { from: 'crates/domain/src/lib.rs', to: 'crates/models/src/lib.rs' },
  ];
  const diff = diffGraphs({
    before: graph({ nodes: [crate('domain')], edges: [] }),
    after: graph({ nodes: [crate('shared'), crate('models')], edges: [] }),
    changedPaths: renames.flatMap(({ from, to }) => [from, to]),
    renames,
  });

  expect(diff.nodes).toStrictEqual([
    { ...crate('shared'), state: 'added' },
    {
      ...crate('models'),
      state: 'modified',
      renamedFrom: 'crates/domain',
      formerLabel: 'domain',
    },
  ]);
});

test('two removed crates whose files went into one added crate stay removed, and the added crate is added', () => {
  const renames = [
    { from: 'crates/adapter/Cargo.toml', to: 'crates/chat/Cargo.toml' },
    { from: 'crates/adapter/src/chat.rs', to: 'crates/chat/src/http.rs' },
    { from: 'crates/models/src/m.rs', to: 'crates/chat/src/domain.rs' },
  ];
  const diff = diffGraphs({
    before: graph({ nodes: [crate('app'), crate('adapter'), crate('models')], edges: [] }),
    after: graph({ nodes: [crate('app'), crate('chat')], edges: [] }),
    changedPaths: [
      ...renames.flatMap(({ from, to }) => [from, to]),
      'crates/adapter/src/lib.rs',
      'crates/adapter/src/other.rs',
      'crates/models/Cargo.toml',
      'crates/models/src/lib.rs',
    ],
    renames,
  });

  expect(diff.nodes.map(({ id, state }) => ({ id, state }))).toStrictEqual([
    { id: 'rust/crate/app', state: 'unchanged' },
    { id: 'rust/crate/chat', state: 'added' },
    { id: 'rust/crate/adapter', state: 'removed' },
    { id: 'rust/crate/models', state: 'removed' },
  ]);
});

test('of two removed crates that most of their files went to one added crate, only the one sending it more pairs with it', () => {
  const renames = [
    { from: 'crates/api/src/lib.rs', to: 'crates/server/src/api.rs' },
    { from: 'crates/api/src/routes.rs', to: 'crates/server/src/routes.rs' },
    { from: 'crates/web/Cargo.toml', to: 'crates/server/Cargo.toml' },
    { from: 'crates/web/src/lib.rs', to: 'crates/server/src/lib.rs' },
    { from: 'crates/web/src/pages.rs', to: 'crates/server/src/pages.rs' },
  ];
  const diff = diffGraphs({
    before: graph({ nodes: [crate('api'), crate('web')], edges: [] }),
    after: graph({ nodes: [crate('server')], edges: [] }),
    changedPaths: [...renames.flatMap(({ from, to }) => [from, to]), 'crates/api/Cargo.toml'],
    renames,
  });

  expect(
    diff.nodes.map(({ id, state, renamedFrom }) => ({ id, state, renamedFrom })),
  ).toStrictEqual([
    { id: 'rust/crate/server', state: 'modified', renamedFrom: 'crates/web' },
    { id: 'rust/crate/api', state: 'removed', renamedFrom: undefined },
  ]);
});

test('a removed file of a renamed crate stays under the crate drawn in its place', () => {
  const fileOf = (name: string, file: string): GraphNode => ({
    id: `rust/mod/${name}/${file}`,
    kind: 'file',
    label: file,
    parent: `rust/crate/${name}`,
    path: `crates/${name}/src/${file}`,
  });
  const renames = [
    { from: 'crates/domain/Cargo.toml', to: 'crates/models/Cargo.toml' },
    { from: 'crates/domain/src/lib.rs', to: 'crates/models/src/lib.rs' },
  ];
  const diff = diffGraphs({
    before: graph({
      nodes: [crate('domain'), fileOf('domain', 'lib.rs'), fileOf('domain', 'gone.rs')],
      edges: [],
    }),
    after: graph({ nodes: [crate('models'), fileOf('models', 'lib.rs')], edges: [] }),
    changedPaths: [...renames.flatMap(({ from, to }) => [from, to]), 'crates/domain/src/gone.rs'],
    renames,
  });

  expect(diff.nodes.map(({ id, state, parent }) => ({ id, state, parent }))).toStrictEqual([
    { id: 'rust/crate/models', state: 'modified', parent: 'rust' },
    { id: 'rust/mod/models/lib.rs', state: 'modified', parent: 'rust/crate/models' },
    { id: 'rust/mod/domain/gone.rs', state: 'removed', parent: 'rust/crate/models' },
  ]);
});

test.for([
  {
    pair: 'no file is renamed across',
    before: [crate('domain')],
    after: [crate('models')],
    rename: { from: 'crates/domain/src/lib.rs', to: 'tools/lib.rs' },
    expected: [
      { id: 'rust/crate/models', state: 'added' },
      { id: 'rust/crate/domain', state: 'removed' },
    ],
  },
  {
    pair: 'a crate and a web module',
    before: [crate('domain')],
    after: [{ ...rootFile('models'), id: 'web/module/models', kind: 'module' as const }],
    rename: { from: 'crates/domain/src/lib.rs', to: 'web/src/models/lib.ts' },
    expected: [
      { id: 'web/module/models', state: 'added' },
      { id: 'rust/crate/domain', state: 'removed' },
    ],
  },
  {
    pair: 'a crate folded into one that was already there',
    before: [crate('application'), crate('domain')],
    after: [crate('application')],
    rename: { from: 'crates/domain/src/lib.rs', to: 'crates/application/src/domain.rs' },
    expected: [
      { id: 'rust/crate/application', state: 'unchanged' },
      { id: 'rust/crate/domain', state: 'removed' },
    ],
  },
  {
    pair: 'a crate split off one that stays',
    before: [crate('application')],
    after: [crate('application'), crate('models')],
    rename: { from: 'crates/application/src/models.rs', to: 'crates/models/src/lib.rs' },
    expected: [
      { id: 'rust/crate/application', state: 'unchanged' },
      { id: 'rust/crate/models', state: 'added' },
    ],
  },
])('nodes stay apart with $pair', ({ before, after, rename, expected }) => {
  const diff = diffGraphs({
    before: graph({ nodes: before, edges: [] }),
    after: graph({ nodes: after, edges: [] }),
    changedPaths: [],
    renames: [rename],
  });

  expect(diff.nodes.map(({ id, state }) => ({ id, state }))).toStrictEqual(expected);
});

test.for([
  {
    move: 'into the graph shows as added',
    before: [],
    after: [rootFile('a.ts')],
    rename: { from: 'tools/a.ts', to: 'web/src/a.ts' },
    expected: [{ ...rootFile('a.ts'), state: 'added', renamedFrom: 'tools/a.ts' }],
  },
  {
    move: 'out of the graph shows as removed',
    before: [rootFile('a.ts')],
    after: [],
    rename: { from: 'web/src/a.ts', to: 'tools/a.ts' },
    expected: [{ ...rootFile('a.ts'), state: 'removed' }],
  },
])('a file renamed $move', ({ before, after, rename, expected }) => {
  const diff = diffGraphs({
    before: { nodes: before, edges: [] },
    after: { nodes: after, edges: [] },
    changedPaths: [rename.from, rename.to],
    renames: [rename],
  });

  expect(diff.nodes).toStrictEqual(expected);
});
