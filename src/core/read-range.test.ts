import { rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { readRange } from '../test-support/read-range.ts';
import {
  cargoWorkspace,
  commit,
  crateFiles,
  git,
  gitRepo,
  pathTo,
  symlinkedDirectory,
  writeFiles,
} from '../test-support/repos.ts';

const rootPackage = { 'package.json': '{}\n', 'src/index.ts': '' };

const nodeIds = (graph: { readonly nodes: ReadonlyArray<{ readonly id: string }> }) =>
  graph.nodes.map(node => node.id);

test('a linear range compares the graph at from with the graph at to, and leaves no worktree behind', async () => {
  using workspace = cargoWorkspace();
  const { repo, root } = workspace;
  const head = commit(repo, { ...crateFiles('cli'), 'README.md': 'cli' });

  const range = await readRange({ repo, from: root, to: head });

  expect(range.before).toEqual({
    nodes: [
      expect.objectContaining({ id: 'rust' }),
      expect.objectContaining({ id: 'rust/crate/core' }),
      expect.objectContaining({ id: 'rust/mod/core/lib.rs' }),
    ],
    edges: [],
  });
  expect(nodeIds(range.after)).toEqual([
    'rust',
    'rust/crate/cli',
    'rust/crate/core',
    'rust/mod/cli/lib.rs',
    'rust/mod/core/lib.rs',
  ]);
  expect(range.changedPaths).toEqual([
    'README.md',
    'crates/cli/Cargo.toml',
    'crates/cli/src/lib.rs',
  ]);
  expect(git(repo, 'worktree', 'list').split('\n')).toHaveLength(1);
});

test("cargo reads each side with the reviewer's toolchain, not one the reviewed revision names", async () => {
  using workspace = cargoWorkspace();
  const { repo, root } = workspace;
  const to = commit(repo, { 'rust-toolchain.toml': '[toolchain]\npath = "not-a-toolchain"\n' });

  const range = await readRange({ repo, from: root, to });

  expect(nodeIds(range.after)).toContain('rust/crate/core');
});

test("cargo reads each side with the reviewed revision's own cargo config", async () => {
  using workspace = cargoWorkspace();
  const { repo, root } = workspace;
  const to = commit(repo, {
    '.cargo/config.toml': '[registries.mine]\nindex = "sparse+https://example.invalid/index/"\n',
    'crates/core/Cargo.toml':
      '[package]\nname = "core"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\nfoo = { version = "1", registry = "mine" }\n',
  });

  const range = await readRange({ repo, from: root, to });

  expect(nodeIds(range.after)).toContain('rust/crate/core');
});

test("each side also has every crate's modules joined by their uses, other targets' files left out", async () => {
  using workspace = cargoWorkspace();
  const { repo, root } = workspace;
  const to = commit(repo, {
    'crates/core/src/lib.rs': 'mod a;\npub use a::Thing;\n',
    'crates/core/src/a.rs': 'pub struct Thing;\n',
    'crates/core/tests/it.rs': '',
    'crates/core/examples/demo.rs': '',
    'crates/core/benches/speed.rs': '',
    'crates/core/build.rs': '',
  });

  const range = await readRange({ repo, from: root, to });

  const moduleIds = (graph: Parameters<typeof nodeIds>[0]) =>
    nodeIds(graph).filter(id => id.startsWith('rust/mod/'));
  expect(moduleIds(range.before)).toEqual(['rust/mod/core/lib.rs']);
  expect(moduleIds(range.after)).toEqual(['rust/mod/core/lib.rs', 'rust/mod/core/a']);
  expect(range.after.edges).toContainEqual({
    from: 'rust/mod/core/lib.rs',
    to: 'rust/mod/core/a',
  });
});

test('each side also has a module per first folder of web/src and its files, files joined by their imports, type-only ones included', async () => {
  using workspace = cargoWorkspace();
  const { repo } = workspace;
  const from = commit(repo, {
    'web/package.json': '{}\n',
    'web/src/modules/A/a.ts': 'export const a = 1;\n',
  });
  const to = commit(repo, {
    'web/src/modules/A/a.ts': "import type { X } from '../../utils/x';\nexport const a: X = 1;\n",
    'web/src/utils/x.ts': 'export type X = number;\n',
  });

  const range = await readRange({ repo, from, to });

  expect(nodeIds(range.before)).toContain('web/module/modules');
  expect(nodeIds(range.before)).not.toContain('web/module/modules/A');
  expect(nodeIds(range.before)).not.toContain('web/module/utils');
  expect(range.after.edges).toContainEqual({
    from: 'web/file/modules/A/a.ts',
    to: 'web/file/utils/x.ts',
  });
});

test("files are still joined by their imports when the temporary directory is a symlink, as macOS's is", async () => {
  using temporary = symlinkedDirectory();
  using workspace = gitRepo({
    'web/package.json': '{}\n',
    'web/src/a.ts': "import { b } from './b';\nexport const a = b;\n",
    'web/src/b.ts': 'export const b = 1;\n',
  });
  const { repo, root } = workspace;
  vi.stubEnv('TMPDIR', temporary.path);

  const range = await readRange({ repo, from: root, to: root });

  expect(range.after.edges).toEqual([{ from: 'web/file/a.ts', to: 'web/file/b.ts' }]);
});

test('every package.json with sources under its src/ is a stack named by its directory, JS-only ones included, node_modules left out', async () => {
  using workspace = gitRepo({
    'apps/a/package.json': '{}\n',
    'apps/a/src/a.js': 'export const a = 1;\n',
    'apps/a/node_modules/x/package.json': '{}\n',
    'apps/a/node_modules/x/src/x.ts': 'export const x = 1;\n',
    'docs/package.json': '{}\n',
  });
  const { repo, root } = workspace;

  const range = await readRange({ repo, from: root, to: root });

  expect(range.after.nodes).toEqual([
    { id: 'apps/a', kind: 'stack', label: 'apps/a', path: '' },
    {
      id: 'apps/a/file/a.js',
      kind: 'file',
      label: 'a.js',
      parent: 'apps/a',
      path: 'apps/a/src/a.js',
    },
  ]);
});

test('in a pnpm monorepo each package is a stack, and a bare import of a sibling package or of its subpath joins the importing file to its stack once, while an import of its own package joins nothing', async () => {
  using workspace = gitRepo({
    'pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n  - 'packages/*'\n",
    'package.json': '{ "name": "mono", "private": true }\n',
    'src/mono.ts': 'export const mono = 1;\n',
    'apps/a/package.json': '{ "name": "a", "dependencies": { "@scope/b": "workspace:*" } }\n',
    'apps/a/src/a.ts':
      "import { b } from '@scope/b';\nimport { u } from '@scope/b/utils';\nimport { mono } from 'mono';\nexport const a = b + u + mono;\n",
    'apps/a/src/c.ts':
      "import { u } from '@scope/b/utils';\nimport { e } from 'mono/extra';\nexport const c = u + e;\n",
    'packages/b/package.json': '{ "name": "@scope/b" }\n',
    'packages/b/src/index.ts': 'export const b = 1;\n',
    'packages/b/src/self.ts': "import { b } from '@scope/b';\nexport const self = b;\n",
  });
  const { repo, root } = workspace;

  const range = await readRange({ repo, from: root, to: root });

  expect(range.after.nodes.filter(({ kind }) => kind === 'stack').map(({ id }) => id)).toEqual([
    'mono',
    'apps/a',
    'packages/b',
  ]);
  expect(range.after.edges).toEqual([
    { from: 'apps/a/file/a.ts', to: 'packages/b' },
    { from: 'apps/a/file/a.ts', to: 'mono' },
    { from: 'apps/a/file/c.ts', to: 'packages/b' },
    { from: 'apps/a/file/c.ts', to: 'mono' },
  ]);
});

test('a package whose source root holds other packages is no stack, so their files are drawn once, in their own stacks', async () => {
  using workspace = gitRepo({
    'package.json': '{ "name": "mono" }\n',
    'tsconfig.json': '{ "include": ["packages/*/src"] }\n',
    'packages/a/package.json': '{}\n',
    'packages/a/src/a.ts': 'export const a = 1;\n',
    'packages/b/package.json': '{}\n',
    'packages/b/src/b.ts': 'export const b = 1;\n',
  });
  const { repo, root } = workspace;

  const range = await readRange({ repo, from: root, to: root });

  expect(nodeIds(range.after)).toEqual([
    'packages/a',
    'packages/a/file/a.ts',
    'packages/b',
    'packages/b/file/b.ts',
  ]);
});

test('with the whole package as source root, built-ins and packages it imports are no files, and a sibling package is still its stack', async () => {
  using workspace = gitRepo({
    'apps/a/package.json': '{}\n',
    'apps/a/tsconfig.json': '{ "compilerOptions": { "rootDir": "." } }\n',
    'apps/a/index.ts':
      "import { readFileSync } from 'node:fs';\nimport { z } from 'zod';\nimport { b } from '@scope/b';\nexport const a = [readFileSync, z, b];\n",
    'packages/b/package.json': '{ "name": "@scope/b" }\n',
    'packages/b/src/index.ts': 'export const b = 1;\n',
  });
  const { repo, root } = workspace;

  const range = await readRange({ repo, from: root, to: root });

  expect(nodeIds(range.after)).toEqual([
    'apps/a',
    'apps/a/file/index.ts',
    'packages/b',
    'packages/b/file/index.ts',
  ]);
  expect(range.after.edges).toEqual([{ from: 'apps/a/file/index.ts', to: 'packages/b' }]);
});

test.for([
  {
    tsconfig: '{ "compilerOptions": { "rootDir": "lib" }, "include": ["libraries"] }',
    files: {
      'lib/a.ts': "import { b } from '../libraries/b';\nexport const a = b;\n",
      'libraries/b.ts': 'export const b = 1;\n',
    },
    drawn: 'lib/a.ts',
  },
  {
    tsconfig: '{}',
    files: { 'src/a.ts': 'export const a = 1;\n', 'lib/b.ts': 'export const b = 1;\n' },
    drawn: 'src/a.ts',
  },
  {
    tsconfig: '{ "include": ["lib", "vite.config.ts"] }',
    files: {
      'lib/a.ts': 'export const a = 1;\n',
      'src/b.ts': 'export const b = 1;\n',
      'vite.config.ts': 'export default {};\n',
    },
    drawn: 'lib/a.ts',
  },
  {
    tsconfig: '{ "include": ["lib/**/*"] }',
    files: { 'lib/a.ts': 'export const a = 1;\n', 'src/b.ts': 'export const b = 1;\n' },
    drawn: 'lib/a.ts',
  },
  {
    tsconfig: '{\n  // tsc --init writes comments\n  "compilerOptions": { "rootDir": "lib", },\n}',
    files: { 'lib/a.ts': 'export const a = 1;\n', 'src/b.ts': 'export const b = 1;\n' },
    drawn: 'lib/a.ts',
  },
  {
    tsconfig: '{ "include": ["**/*"] }',
    files: { 'src/a.ts': 'export const a = 1;\n', 'lib/b.ts': 'export const b = 1;\n' },
    drawn: 'src/a.ts',
  },
  {
    tsconfig: '{ "include": ["lib/**/*.ts", "./lib/**/*.tsx"] }',
    files: { 'lib/a.ts': 'export const a = 1;\n', 'src/b.ts': 'export const b = 1;\n' },
    drawn: 'lib/a.ts',
  },
  {
    tsconfig: '{ "include": ["lib", "test"] }',
    files: {
      'lib/a.ts': 'export const a = 1;\n',
      'test/a.ts': 'export const a = 1;\n',
      'src/b.ts': 'export const b = 1;\n',
    },
    drawn: 'src/b.ts',
  },
  {
    tsconfig: '{ "compilerOptions": { "rootDir": "./lib/" } }',
    files: { 'lib/a.ts': 'export const a = 1;\n', 'src/b.ts': 'export const b = 1;\n' },
    drawn: 'lib/a.ts',
  },
  {
    tsconfig: '{ "include": ["./lib"] }',
    files: { 'lib/a.ts': 'export const a = 1;\n', 'src/b.ts': 'export const b = 1;\n' },
    drawn: 'lib/a.ts',
  },
  {
    tsconfig: '{ "include": ["./**/*"] }',
    files: { 'src/a.ts': 'export const a = 1;\n', 'lib/b.ts': 'export const b = 1;\n' },
    drawn: 'src/a.ts',
  },
  {
    tsconfig: '// nothing yet',
    files: { 'src/a.ts': 'export const a = 1;\n', 'lib/b.ts': 'export const b = 1;\n' },
    drawn: 'src/a.ts',
  },
  {
    tsconfig: '{ "include": "lib" }',
    files: { 'src/a.ts': 'export const a = 1;\n', 'lib/b.ts': 'export const b = 1;\n' },
    drawn: 'src/a.ts',
  },
  {
    tsconfig: '{ "compilerOptions": { "rootDir": "." } }',
    files: { 'a.ts': 'export const a = 1;\n' },
    drawn: 'a.ts',
  },
])(
  "a package's source root is its tsconfig's rootDir, else its one included folder, else src/, however the folder is written (. is the whole package): $tsconfig",
  async ({ tsconfig, files, drawn }) => {
    using workspace = gitRepo({
      'apps/a/package.json': '{}\n',
      'apps/a/tsconfig.json': `${tsconfig}\n`,
      ...Object.fromEntries(Object.entries(files).map(([path, text]) => [`apps/a/${path}`, text])),
    });
    const { repo, root } = workspace;

    const range = await readRange({ repo, from: root, to: root });

    expect(range.after.nodes.map(({ id, path }) => [id, path])).toEqual([
      ['apps/a', ''],
      [`apps/a/file/${basename(drawn)}`, `apps/a/${drawn}`],
    ]);
  },
);

test('a package.json at the root of the repo names its stack, while its paths stay those of the repo', async () => {
  using workspace = gitRepo({
    'package.json': '{ "name": "@scope/tool" }\n',
    'src/a.ts': 'export const a = 1;\n',
  });
  const { repo, root } = workspace;

  const range = await readRange({ repo, from: root, to: root });

  expect(range.after.nodes).toEqual([
    { id: '@scope/tool', kind: 'stack', label: '@scope/tool', path: '' },
    {
      id: '@scope/tool/file/a.ts',
      kind: 'file',
      label: 'a.ts',
      parent: '@scope/tool',
      path: 'src/a.ts',
    },
  ]);
});

test("a package.json at the root named like another package's directory leaves that package's stack a ~2 suffix, which imports of it reach", async () => {
  using workspace = gitRepo({
    'package.json': '{ "name": "web" }\n',
    'src/a.ts': "import { b } from '@x/web';\nexport const a = b;\n",
    'web/package.json': '{ "name": "@x/web" }\n',
    'web/src/b.ts': "import { c } from 'web/c';\nexport const b = c;\n",
  });
  const { repo, root } = workspace;

  const range = await readRange({ repo, from: root, to: root });

  expect(nodeIds(range.after)).toEqual(['web', 'web/file/a.ts', 'web~2', 'web~2/file/b.ts']);
  expect(range.after.edges).toEqual([
    { from: 'web/file/a.ts', to: 'web~2' },
    { from: 'web~2/file/b.ts', to: 'web' },
  ]);
});

test.for([
  { packageJson: '{}', named: undefined },
  { packageJson: '{ "name": 1 }', named: undefined },
  { packageJson: '\uFEFF{ "name": "tool", }', named: 'tool' },
])(
  'a package.json at the root of the repo names its stack, and the repo folder does when it has no readable name: $packageJson',
  async ({ packageJson, named }) => {
    using workspace = gitRepo({
      'package.json': `${packageJson}\n`,
      'src/a.ts': 'export const a = 1;\n',
    });
    const { repo, root } = workspace;

    const range = await readRange({ repo, from: root, to: root });

    const stack = named ?? basename(repo);
    expect(nodeIds(range.after)).toEqual([stack, `${stack}/file/a.ts`]);
  },
);

test('each changed file comes with its own patch, keyed by its path, and edited files are no renames', async () => {
  using workspace = cargoWorkspace();
  const { repo, root } = workspace;
  const to = commit(repo, {
    'crates/core/src/lib.rs': 'pub fn core() {}\n',
    'web/src/a.ts': 'export const a = 1;\n',
  });

  const range = await readRange({ repo, from: root, to });

  expect(range.renames).toEqual([]);
  expect(range.patches).toEqual([
    {
      path: 'crates/core/src/lib.rs',
      patch: expect.stringMatching(
        /^diff --git a\/crates\/core\/src\/lib\.rs .*\n\+pub fn core\(\) \{\}$/s,
      ),
    },
    {
      path: 'web/src/a.ts',
      patch: expect.stringMatching(/^diff --git a\/web\/src\/a\.ts .*\n\+export const a = 1;$/s),
    },
  ]);
});

test("each side's churn counts, for each file a node is drawn from, the commits touching it in the 90 days up to that side's commit", async () => {
  using repository = gitRepo({
    'package.json': '{}\n',
    'src/a.ts': '',
    'src/b.ts': '',
    'src/c.ts': '',
  });
  const { repo } = repository;
  commit(repo, { 'src/a.ts': '1' }, { date: '2090-01-01T00:00:00Z' });
  commit(repo, { 'src/a.ts': '2' }, { date: '2090-05-01T00:00:00Z' });
  const base = commit(repo, { 'src/a.ts': '3', 'src/b.ts': '1' }, { date: '2090-06-01T00:00:00Z' });
  commit(repo, { 'src/a.ts': '4' }, { date: '2090-08-01T00:00:00Z' });
  const rebasedHead = { date: '2090-09-15T00:00:00Z', authorDate: '2090-01-01T00:00:00Z' };
  const head = commit(repo, { 'src/b.ts': '2' }, rebasedHead);

  const range = await readRange({ repo, from: base, to: head });

  expect(range.churn).toEqual({
    before: { 'src/a.ts': 2, 'src/b.ts': 1, 'src/c.ts': 0 },
    after: { 'src/a.ts': 1, 'src/b.ts': 1, 'src/c.ts': 0 },
  });
});

const simpleFn = (name: string) => ({
  name,
  cyclomatic: 1,
  abc: { assignments: 0, branches: 0, conditions: 0 },
});

test("each side measures the files of the changed nodes and their neighbours with their stack's reader, if it measures, and no directory", async () => {
  using workspace = cargoWorkspace();
  const { repo } = workspace;
  const lib = 'crates/core/src/lib.rs';
  const base = commit(repo, { ...crateFiles('other'), ...rootPackage, [lib]: 'pub fn a() {}\n' });
  const head = commit(repo, {
    ...crateFiles('cli'),
    'src/index.ts': 'export const a = 1;\n',
    [lib]: 'pub fn a() {}\n\npub fn b() {}\n',
  });

  const range = await readRange({ repo, from: base, to: head });

  expect(range.measures).toEqual({
    before: {
      [lib]: { lines: 1, functions: [simpleFn('a')] },
      'src/index.ts': { lines: 0, functions: [] },
    },
    after: {
      [lib]: { lines: 2, functions: [simpleFn('a'), simpleFn('b')] },
      'crates/cli/src/lib.rs': { lines: 0, functions: [] },
      'src/index.ts': { lines: 1, functions: [] },
    },
  });
});

test('a TS test file is left unmeasured, and the file it imports is measured', async () => {
  using repository = gitRepo(rootPackage);
  const { repo, root } = repository;
  const head = commit(repo, { 'src/index.test.ts': "import './index.ts';\n" });

  const range = await readRange({ repo, from: root, to: head });

  expect(range.measures.after).toStrictEqual({ 'src/index.ts': { lines: 0, functions: [] } });
});

test('a renamed file is measured at its former path on the before side', async () => {
  using workspace = cargoWorkspace();
  const { repo } = workspace;
  const base = commit(repo, {
    'crates/core/src/lib.rs': 'mod old;\n',
    'crates/core/src/old.rs': 'pub fn kept() {}\n',
  });
  git(repo, 'mv', 'crates/core/src/old.rs', 'crates/core/src/new.rs');
  const head = commit(repo, { 'crates/core/src/lib.rs': 'mod new;\n' });

  const range = await readRange({ repo, from: base, to: head });

  expect(range.measures.before).toEqual(
    expect.objectContaining({
      'crates/core/src/old.rs': { lines: 1, functions: [simpleFn('kept')] },
    }),
  );
});

test('a stack the head adds is measured on the head side', async () => {
  using repository = gitRepo(rootPackage);
  const { repo, root } = repository;
  const head = commit(repo, {
    'Cargo.toml': '[workspace]\nmembers = ["crates/*"]\nresolver = "2"\n',
    ...crateFiles('core'),
  });

  const range = await readRange({ repo, from: root, to: head });

  expect(range.measures.after).toEqual({ 'crates/core/src/lib.rs': { lines: 0, functions: [] } });
});

test('a file its reader fails to measure is left unmeasured, and the range is still read', async () => {
  using workspace = cargoWorkspace();
  const { repo, root } = workspace;
  const deep = `pub fn deep() -> u32 { ${Array.from({ length: 5000 }, () => '1').join(' + ')} }\n`;
  const head = commit(repo, { 'crates/core/src/lib.rs': deep });

  const range = await readRange({ repo, from: root, to: head });

  expect(range.measures.after).toEqual({});
});

test('a range ending at a branch named like a folder reads its churn', async () => {
  using repository = gitRepo({ 'package.json': '{}\n', 'src/a.ts': '' });
  const { repo } = repository;
  const base = commit(repo, { 'src/a.ts': '1' });
  git(repo, 'switch', '--quiet', '--create', 'src');
  commit(repo, { 'src/a.ts': '2' });

  const range = await readRange({ repo, from: base, to: 'src' });

  expect(range.churn.after).toEqual({ 'src/a.ts': 3 });
});

test('churn counts a file whose path git would quote', async () => {
  using repository = gitRepo({ 'package.json': '{}\n', 'src/café.ts': '' });
  const { repo } = repository;
  const base = commit(repo, { 'src/café.ts': '1' });
  const head = commit(repo, { 'src/café.ts': '2' });

  const range = await readRange({ repo, from: base, to: head });

  expect(range.churn.after).toEqual({ 'src/café.ts': 3 });
});

test('churn reads a history whose touched paths run past a megabyte', async () => {
  using repository = gitRepo({ 'package.json': '{}\n', 'src/a.ts': '' });
  const { repo } = repository;
  const deep = Array.from({ length: 14 }, (_, level) => `${level}`.padEnd(250, 'x')).join('/');
  writeFiles(
    repo,
    Object.fromEntries(Array.from({ length: 320 }, (_, file) => [`${deep}/${file}`, ''])),
  );
  git(repo, 'add', '--all');
  git(repo, 'commit', '--quiet', '--message', 'deep files');
  const base = commit(repo, { 'src/a.ts': '1' });
  const head = commit(repo, { 'src/a.ts': '2' });

  const range = await readRange({ repo, from: base, to: head });

  expect(range.churn.after).toEqual({ 'src/a.ts': 3 });
});

test('a reader whose tool is not on PATH reads none of its stacks and is listed as skipped with them, while the other readers still read theirs', async () => {
  using workspace = cargoWorkspace();
  const { repo, root } = workspace;
  const to = commit(repo, rootPackage);
  using bin = pathTo('git');
  vi.stubEnv('PATH', bin.path);

  const range = await readRange({ repo, from: root, to });

  expect(nodeIds(range.after)).toEqual([basename(repo), `${basename(repo)}/file/index.ts`]);
  expect(range.skipped).toEqual([{ reader: 'rust', tool: 'cargo', stacks: ['rust'] }]);
});

test('a skipped reader lists the stacks it would read on either side, those found only before the range and those only after', async () => {
  using workspace = cargoWorkspace();
  const { repo, root } = workspace;
  git(repo, 'rm', '--quiet', '-r', 'Cargo.toml', 'crates');
  const to = commit(repo, {
    'other/Cargo.toml': '[workspace]\n',
    'visual-review.config.json': '{"stacks": {"other": {"reader": "rust", "root": "other"}}}\n',
  });

  const range = await readRange({ repo, from: root, to, onPath: command => command !== 'cargo' });

  expect(range.skipped).toEqual([{ reader: 'rust', tool: 'cargo', stacks: ['rust', 'other'] }]);
});

test('a file moved between modules is one rename, with one patch at its new path that shows only what changed', async () => {
  using workspace = cargoWorkspace();
  const { repo } = workspace;
  const lines = (c: number) =>
    `export const a = 1;\nexport const b = 2;\nexport const c = ${c};\nexport const d = 4;\n`;
  const from = commit(repo, { 'web/src/modules/A/a.ts': lines(3) });
  rmSync(join(repo, 'web/src/modules/A/a.ts'));
  const to = commit(repo, { 'web/src/modules/B/a.ts': lines(30) });

  const range = await readRange({ repo, from, to });

  expect(range.changedPaths).toEqual(['web/src/modules/A/a.ts', 'web/src/modules/B/a.ts']);
  expect(range.renames).toEqual([{ from: 'web/src/modules/A/a.ts', to: 'web/src/modules/B/a.ts' }]);
  expect(range.patches).toEqual([
    {
      path: 'web/src/modules/B/a.ts',
      patch: expect.stringMatching(
        /rename from web\/src\/modules\/A\/a\.ts\n.*\n-export const c = 3;\n\+export const c = 30;/s,
      ),
    },
  ]);
});

test('each changed test file whose tests changed comes with its marked statements, drawn or not, a test that left one for another marked moved, and a file new in the range marked new', async () => {
  using workspace = cargoWorkspace();
  const { repo } = workspace;
  const from = commit(repo, {
    ...rootPackage,
    'e2e/tests/home.spec.ts': "test('shows the version', () => {});\n",
    'tools/review/notes.test.ts': "const id = 'a';\ntest('reads notes', () => {});\n",
  });
  rmSync(join(repo, 'e2e/tests/home.spec.ts'));
  const to = commit(repo, {
    'tools/review/notes.test.ts': "const id = 'b';\ntest('reads notes', () => {});\n",
    'tools/review/notes.ts': "test('is not a test file', () => {});\n",
    'tools/review/notes.test.ts.snap': "test('is a snapshot', () => {});\n",
    'docs/testing.rst': '#[test]\nfn is_documentation() {}\n',
    'web/src/page.test.tsx':
      "it('shows the range', () => {});\nit('shows the version', () => {});\n",
    'crates/core/tests/serve.rs': '#[test]\nfn rejects_an_unknown_route() {}\n',
  });

  const range = await readRange({ repo, from, to });

  expect(range.tests).toEqual([
    {
      path: 'crates/core/tests/serve.rs',
      new: true,
      statements: [{ kind: 'test', name: 'rejects an unknown route', change: 'added' }],
    },
    {
      path: 'e2e/tests/home.spec.ts',
      statements: [
        {
          kind: 'test',
          name: 'shows the version',
          change: 'removed',
          movedTo: 'web/src/page.test.tsx',
        },
      ],
    },
    {
      path: 'web/src/page.test.tsx',
      new: true,
      statements: [
        { kind: 'test', name: 'shows the range', change: 'added' },
        {
          kind: 'test',
          name: 'shows the version',
          change: 'added',
          movedFrom: 'e2e/tests/home.spec.ts',
        },
      ],
    },
  ]);
});

test("a changed test file is read only under a root of its reader's stack on either side", async () => {
  using workspace = gitRepo({
    'apps/a/package.json': '{}\n',
    'apps/a/src/a.ts': '',
    'apps/old/package.json': '{}\n',
    'apps/old/src/old.test.ts': "test('reads old', () => {});\n",
  });
  const { repo, root } = workspace;
  rmSync(join(repo, 'apps/old'), { recursive: true });
  const to = commit(repo, {
    'apps/a/src/a.test.ts': "test('reads a', () => {});\n",
    'apps/a/src/b.test.js': "test('reads b', () => {});\n",
    'apps/a/src/c.spec.mjs': "test('reads c', () => {});\n",
    'tools/x.test.ts': "test('reads x', () => {});\n",
    'crates/x/tests/x.rs': '#[test]\nfn reads_x() {}\n',
  });

  const range = await readRange({ repo, from: root, to });

  expect(range.tests.map(({ path }) => path)).toEqual([
    'apps/a/src/a.test.ts',
    'apps/a/src/b.test.js',
    'apps/a/src/c.spec.mjs',
    'apps/old/src/old.test.ts',
  ]);
});

test('a renamed test file is listed once under its new path, compared against its old one', async () => {
  using workspace = cargoWorkspace();
  const { repo } = workspace;
  const tests = ['reads notes', 'names an unknown id', 'lists unplaced notes', 'reads a summary'];
  const file = (names: ReadonlyArray<string>) =>
    names.map(name => `test('${name}', () => {\n  expect(1).toBe(1);\n});\n`).join('');
  const from = commit(repo, { ...rootPackage, 'tools/review/notes.test.ts': file(tests) });
  rmSync(join(repo, 'tools/review/notes.test.ts'));
  const to = commit(repo, { 'tools/review/notes-file.test.ts': file([...tests, 'reads flags']) });

  const range = await readRange({ repo, from, to });

  expect(range.tests).toEqual([
    {
      path: 'tools/review/notes-file.test.ts',
      renamedFrom: 'tools/review/notes.test.ts',
      statements: [
        ...tests.map(name => ({ kind: 'test', name, change: 'unchanged' })),
        { kind: 'test', name: 'reads flags', change: 'added' },
      ],
    },
  ]);
});

test('a changed test file that does not parse is listed with the parser message, still marked new when it is', async () => {
  using workspace = cargoWorkspace();
  const { repo, root } = workspace;
  const to = commit(repo, {
    ...rootPackage,
    'tools/review/notes.test.ts': "test('reads notes', () => {\n",
  });

  const range = await readRange({ repo, from: root, to });

  expect(range.tests).toEqual([
    {
      path: 'tools/review/notes.test.ts',
      new: true,
      unreadable: expect.stringMatching(/\(2:0\)$/),
    },
  ]);
});

test('when from is not an ancestor of to, before is their merge base and changed paths are only those since it', async () => {
  using workspace = cargoWorkspace();
  const { repo } = workspace;
  git(repo, 'switch', '--quiet', '--create', 'side');
  const side = commit(repo, {
    ...crateFiles('side'),
    'crates/core/src/lib.rs': 'pub fn side() {}\n',
  });
  git(repo, 'switch', '--quiet', 'main');
  const main = commit(repo, { 'README.md': 'main' });

  const range = await readRange({ repo, from: side, to: main });

  expect(nodeIds(range.before)).toEqual(['rust', 'rust/crate/core', 'rust/mod/core/lib.rs']);
  expect(range.churn.before).toEqual({ 'crates/core/src/lib.rs': 1 });
  expect(range.changedPaths).toEqual(['README.md']);
});

test.for([
  { end: 'from', range: { from: 'no-such-branch', to: 'HEAD' } },
  { end: 'to', range: { from: 'HEAD', to: 'no-such-branch' } },
])('an unknown $end revision fails naming it', async ({ range }) => {
  using workspace = cargoWorkspace();

  await expect(readRange({ repo: workspace.repo, ...range })).rejects.toThrow(
    'Unknown revision: no-such-branch',
  );
});

test('a range with no commits in it has no changed paths and no patches', async () => {
  using workspace = cargoWorkspace();
  const { repo, root } = workspace;

  const range = await readRange({ repo, from: root, to: root });

  expect(range.changedPaths).toEqual([]);
  expect(range.patches).toEqual([]);
});

test('when reading a graph fails, the error surfaces and no worktree is left behind', async () => {
  using workspace = cargoWorkspace();
  const { repo, root } = workspace;
  const broken = commit(repo, { 'crates/core/Cargo.toml': '[package' });

  await expect(readRange({ repo, from: root, to: broken })).rejects.toThrow(/cargo metadata/);
  expect(git(repo, 'worktree', 'list').split('\n')).toHaveLength(1);
});
