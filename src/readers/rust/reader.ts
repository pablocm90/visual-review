import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { Graph } from '../../core/graph.ts';
import type { Reader } from '../../core/reader.ts';
import { StackNotRead } from '../../core/skipped.ts';
import { sourcesIn } from '../sources-in.ts';
import { crateGraph, crateRoots } from './crate-graph.ts';
import { crateModules } from './crate-modules.ts';
import { measureRust } from './rust-measure.ts';
import { symbolsOfRust } from './rust-symbols.ts';
import { TEST_FOLDER } from './rust-syntax.ts';
import { readRustTests } from './rust-tests.ts';
import { usesOfRust } from './rust-uses.ts';

const run = promisify(execFile);

const reviewersToolchain = (outside: string): Promise<NodeJS.ProcessEnv> =>
  run('rustup', ['show', 'active-toolchain'], { cwd: outside }).then(
    ({ stdout }) => ({ ...process.env, RUSTUP_TOOLCHAIN: stdout.split(' ')[0] }),
    () => process.env,
  );

const CARGO_ERROR = 'error: ';

const firstErrorOf = (error: unknown): string | undefined =>
  error instanceof Error && 'stderr' in error && typeof error.stderr === 'string'
    ? error.stderr
        .split('\n')
        .find(line => line.startsWith(CARGO_ERROR))
        ?.slice(CARGO_ERROR.length)
    : undefined;

const notReadBy = ({ error, checkout }: { readonly error: unknown; readonly checkout: string }) => {
  const first = firstErrorOf(error);
  throw first === undefined
    ? error
    : new StackNotRead(`cargo: ${first.replaceAll(`${checkout}/`, '')}`);
};

type GraphAtOptions = {
  readonly checkout: string;
  readonly root: string;
  readonly stack: string;
};

const graphAt = async ({ checkout, root, stack }: GraphAtOptions): Promise<Graph> => {
  const directory = join(checkout, root);
  const reading = run(
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
  reading.child.stdin?.end();
  const { stdout } = await reading.catch((error: unknown) => notReadBy({ error, checkout }));
  const crates = crateGraph({ metadataJson: stdout, stack, root });
  const modules = await Promise.all(
    crateRoots(stdout).map(async ({ crate, directory: crateDirectory, roots }) => {
      const files = await sourcesIn(directory, join(crateDirectory, '**/*.rs'));
      const sources = Object.fromEntries(files.map(({ file, text }) => [file, text]));
      return crateModules({ stack, root, crate, roots, sources });
    }),
  );
  return {
    nodes: [...crates.nodes, ...modules.flatMap(graph => graph.nodes)],
    edges: [...crates.edges, ...modules.flatMap(graph => graph.edges)],
  };
};

export const rustReader: Reader = {
  name: 'rust',
  tool: 'cargo',
  stackFields: [],
  roots: () => [{ root: '.', name: 'rust' }],
  holds: ({ directory, root }) => existsSync(join(directory, root, 'Cargo.toml')),
  graph: ({ directory, root, stack }) => graphAt({ checkout: directory, root, stack }),
  isTestFile: path => path.endsWith('.rs'),
  readTests: readRustTests,
  measure: measureRust,
  symbols: (text, path) =>
    path.endsWith('.rs') && !TEST_FOLDER.test(path) ? symbolsOfRust(text) : undefined,
  uses: usesOfRust,
};
