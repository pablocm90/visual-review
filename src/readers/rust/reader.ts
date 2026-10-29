import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { Graph } from '../../core/graph.ts';
import type { Reader } from '../../core/reader.ts';
import { sourcesIn } from '../sources-in.ts';
import { crateGraph, crateRoots } from './crate-graph.ts';
import { crateModules } from './crate-modules.ts';
import { readRustTests } from './rust-tests.ts';

const run = promisify(execFile);

const reviewersToolchain = (outside: string): Promise<NodeJS.ProcessEnv> =>
  run('rustup', ['show', 'active-toolchain'], { cwd: outside }).then(
    ({ stdout }) => ({ ...process.env, RUSTUP_TOOLCHAIN: stdout.split(' ')[0] }),
    () => process.env,
  );

const graphAt = async (checkout: string, root: string): Promise<Graph> => {
  const directory = join(checkout, root);
  const { stdout } = await run(
    'cargo',
    [
      'metadata',
      '--no-deps',
      '--format-version',
      '1',
      '--manifest-path',
      join(directory, 'Cargo.toml'),
    ],
    { cwd: directory, env: await reviewersToolchain(dirname(checkout)) },
  );
  const crates = crateGraph(stdout);
  const modules = await Promise.all(
    crateRoots(stdout).map(async ({ crate, directory: crateDirectory, roots }) => {
      const files = await sourcesIn(directory, join(crateDirectory, '**/*.rs'));
      const sources = Object.fromEntries(files.map(({ file, text }) => [file, text]));
      return crateModules({ crate, roots, sources });
    }),
  );
  return {
    nodes: [...crates.nodes, ...modules.flatMap(graph => graph.nodes)],
    edges: [...crates.edges, ...modules.flatMap(graph => graph.edges)],
  };
};

type RebaseOptions = {
  readonly stack: string;
  readonly root: string;
};

const rebased = (graph: Graph, { stack, root }: RebaseOptions): Graph => {
  const id = (old: string): string => `${stack}${old.slice('rust'.length)}`;
  return {
    nodes: graph.nodes.map(node => ({
      ...node,
      id: id(node.id),
      label: node.parent === undefined ? stack : node.label,
      ...(node.parent === undefined ? {} : { parent: id(node.parent) }),
      path: node.kind === 'stack' ? '' : join(root, node.path),
    })),
    edges: graph.edges.map(edge => ({ ...edge, from: id(edge.from), to: id(edge.to) })),
  };
};

export const rustReader: Reader = {
  name: 'rust',
  tool: 'cargo',
  stackFields: [],
  roots: () => [{ root: '.', name: 'rust' }],
  holds: ({ directory, root }) => existsSync(join(directory, root, 'Cargo.toml')),
  graph: async ({ directory, root, stack }) =>
    rebased(await graphAt(directory, root), { stack, root }),
  isTestFile: path => path.endsWith('.rs'),
  readTests: readRustTests,
};
