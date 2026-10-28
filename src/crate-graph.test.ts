import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { crateGraph } from './crate-graph.ts';

const recordedAtAb4cb6a = readFileSync(
  join(import.meta.dirname, 'fixtures', 'cargo-metadata-ab4cb6a.json'),
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
  const graph = crateGraph(recordedAtAb4cb6a);

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
  const graph = crateGraph(
    twoCrateMetadata([{ path: '/repo/crates/core' }, { path: '/repo/crates/core' }]),
  );

  expect(graph.edges).toEqual([dependency('cli', 'core')]);
});

test('a path dependency outside the workspace gives no edge', () => {
  const graph = crateGraph(twoCrateMetadata([{ path: '/elsewhere/vendored' }]));

  expect(graph.edges).toEqual([]);
});

test('metadata missing the fields the graph needs is rejected rather than read as a partial graph', () => {
  expect(() => crateGraph(JSON.stringify({ packages: [] }))).toThrow(/workspace_root/);
});
