import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { crateGraph } from './crate-graph.ts';

const recordedAtAb4cb6a = readFileSync(
  join(import.meta.dirname, '..', '..', 'fixtures', 'cargo-metadata-ab4cb6a.json'),
  'utf8',
);

const crateNode = (name: string) => ({
  id: `rust/crate/${name}`,
  kind: 'package',
  label: name,
  parent: 'rust',
  path: `crates/${name}`,
});

const dependency = (from: string, to: string) => ({
  from: `rust/crate/${from}`,
  to: `rust/crate/${to}`,
});

test('the workspace crates become nodes under a rust stack, joined by their path dependencies only', () => {
  const graph = crateGraph({ metadataJson: recordedAtAb4cb6a, stack: 'rust', root: '.' });

  expect(graph.nodes).toEqual([
    { id: 'rust', kind: 'stack', label: 'rust', path: '' },
    crateNode('application'),
    crateNode('domain'),
    crateNode('cli-adapter'),
    crateNode('http-adapter'),
    crateNode('shop'),
    crateNode('postgres-adapter'),
  ]);
  expect(graph.edges).toEqual([
    dependency('application', 'domain'),
    dependency('cli-adapter', 'application'),
    dependency('cli-adapter', 'domain'),
    dependency('http-adapter', 'application'),
    dependency('http-adapter', 'domain'),
    dependency('shop', 'application'),
    dependency('shop', 'cli-adapter'),
    dependency('shop', 'http-adapter'),
    dependency('shop', 'postgres-adapter'),
    dependency('postgres-adapter', 'application'),
  ]);
});

const twoCrateMetadata = (cliDependencies: ReadonlyArray<{ readonly path?: string }>) =>
  JSON.stringify({
    workspace_root: '/repo',
    packages: [
      {
        name: 'core',
        manifest_path: '/repo/crates/core/Cargo.toml',
        dependencies: [],
        targets: [],
      },
      {
        name: 'cli',
        manifest_path: '/repo/crates/cli/Cargo.toml',
        dependencies: cliDependencies,
        targets: [],
      },
    ],
  });

test('a crate depending on another as both a normal and a dev dependency has one edge to it', () => {
  const graph = crateGraph({
    metadataJson: twoCrateMetadata([{ path: '/repo/crates/core' }, { path: '/repo/crates/core' }]),
    stack: 'rust',
    root: '.',
  });

  expect(graph.edges).toEqual([dependency('cli', 'core')]);
});

test('a path dependency outside the workspace gives no edge', () => {
  const graph = crateGraph({
    metadataJson: twoCrateMetadata([{ path: '/elsewhere/vendored' }]),
    stack: 'rust',
    root: '.',
  });

  expect(graph.edges).toEqual([]);
});

test('a workspace read as another stack at a folder of the repo draws its crates under that stack, with repo paths', () => {
  const graph = crateGraph({
    metadataJson: twoCrateMetadata([{ path: '/repo/crates/core' }]),
    stack: 'api',
    root: 'backend',
  });

  expect(graph).toEqual({
    nodes: [
      { id: 'api', kind: 'stack', label: 'api', path: '' },
      {
        id: 'api/crate/core',
        kind: 'package',
        label: 'core',
        parent: 'api',
        path: 'backend/crates/core',
      },
      {
        id: 'api/crate/cli',
        kind: 'package',
        label: 'cli',
        parent: 'api',
        path: 'backend/crates/cli',
      },
    ],
    edges: [{ from: 'api/crate/cli', to: 'api/crate/core' }],
  });
});

test('metadata missing the fields the graph needs is rejected rather than read as a partial graph', () => {
  expect(() =>
    crateGraph({ metadataJson: JSON.stringify({ packages: [] }), stack: 'rust', root: '.' }),
  ).toThrow(/workspace_root/);
});
