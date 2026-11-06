import { existsSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { typeScriptReader } from '../readers/typescript/reader.ts';
import { NOT_DRAWN } from '../readers/typescript/typescript-uses.ts';
import { fakeReader } from '../test-support/fakes.ts';
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
import { reviewedHead } from '../test-support/reviewed.ts';

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

const climbingTo = (repo: string) => `${'../'.repeat(30)}${repo}/outside`;

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

test.for([
  {
    how: 'a wildcard',
    tsconfig: '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }',
    imported: '@/lib/a',
  },
  {
    how: 'an exact name',
    tsconfig: '{ "compilerOptions": { "paths": { "the-lib": ["./src/lib/a.ts"] } } }',
    imported: 'the-lib',
  },
  {
    how: 'its second place, when the first holds nothing',
    tsconfig: '{ "compilerOptions": { "paths": { "@/*": ["./gone/*", "./src/*"] } } }',
    imported: '@/lib/a',
  },
  {
    how: 'a place relative to baseUrl',
    tsconfig: '{ "compilerOptions": { "baseUrl": "./src", "paths": { "@/*": ["./*"] } } }',
    imported: '@/lib/a',
  },
  {
    how: 'a place climbing from baseUrl, inside the checkout',
    tsconfig: '{ "compilerOptions": { "baseUrl": "./src/lib", "paths": { "@/*": ["../*"] } } }',
    imported: '@/lib/a',
  },
  {
    how: 'a bare name under baseUrl',
    tsconfig: '{ "compilerOptions": { "baseUrl": "./src" } }',
    imported: 'lib/a',
  },
  {
    how: 'a wildcard, under an exact name of its folder',
    tsconfig:
      '{ "compilerOptions": { "paths": { "@/lib": ["./src/lib/a.ts"], "@/*": ["./src/*"] } } }',
    imported: '@/lib/a',
  },
])('an import through a tsconfig path draws its edge: $how', async ({ tsconfig, imported }) => {
  using workspace = gitRepo({
    'package.json': '{ "name": "shop" }\n',
    'tsconfig.json': `${tsconfig}\n`,
    'src/lib/a.ts': 'export const a = 1;\n',
    'src/src/lib/a.ts': 'export const a = 2;\n',
    'src/b.ts': `import { a } from '${imported}';\nexport const b = a;\n`,
  });
  const { repo, root } = workspace;

  const range = await readRange({ repo, from: root, to: root });

  expect(range.after.edges).toEqual([{ from: 'shop/file/b.ts', to: 'shop/file/lib/a.ts' }]);
});

test.for([
  { order: 'shorter first', paths: { '@/*': ['./src/*'], '@/lib/*': ['./src/vendored/*'] } },
  { order: 'longer first', paths: { '@/lib/*': ['./src/vendored/*'], '@/*': ['./src/*'] } },
  {
    order: 'an exact name after the wildcard it also matches',
    paths: { '@/lib/*': ['./src/lib/*'], '@/lib/a': ['./src/vendored/a.ts'] },
  },
])('the longest tsconfig path prefix wins, written $order', async ({ paths }) => {
  using workspace = gitRepo({
    'package.json': '{ "name": "shop" }\n',
    'tsconfig.json': `${JSON.stringify({ compilerOptions: { paths } })}\n`,
    'src/lib/a.ts': 'export const a = 1;\n',
    'src/vendored/a.ts': 'export const a = 2;\n',
    'src/b.ts': "import { a } from '@/lib/a';\nexport const b = a;\n",
  });
  const { repo, root } = workspace;

  const range = await readRange({ repo, from: root, to: root });

  expect(range.after.edges).toEqual([{ from: 'shop/file/b.ts', to: 'shop/file/vendored/a.ts' }]);
});

test.for([
  { how: 'a catch-all', paths: { '*': ['./src/*'] }, imported: './a' },
  { how: 'a pattern with no prefix', paths: { '*.js': ['./src/*.ts'] }, imported: './a.js' },
  { how: 'a relative pattern', paths: { './*': ['./src/*'] }, imported: './a' },
])('a relative import stays relative under $how', async ({ paths, imported }) => {
  using workspace = gitRepo({
    'package.json': '{ "name": "shop" }\n',
    'tsconfig.json': `${JSON.stringify({ compilerOptions: { paths } })}\n`,
    'src/a.ts': 'export const a = 1;\n',
    'src/x/a.ts': 'export const a = 2;\n',
    'src/x/b.ts': `import { a } from '${imported}';\nexport const b = a;\n`,
  });
  const { repo, root } = workspace;

  const range = await readRange({ repo, from: root, to: root });

  expect(range.after.edges).toEqual([{ from: 'shop/file/x/b.ts', to: 'shop/file/x/a.ts' }]);
});

test('a catch-all tsconfig path finds a bare import in each of its folders', async () => {
  using workspace = gitRepo({
    'package.json': '{ "name": "shop" }\n',
    'tsconfig.json':
      '{ "compilerOptions": { "paths": { "*": ["./gone/*", "./src/lib/*", "./src/only.ts"] } } }\n',
    'src/lib/a.ts': 'export const a = 1;\n',
    'src/src/lib/a.ts': 'export const a = 2;\n',
    'src/c.ts': 'export const c = 1;\n',
    'src/only.ts': 'export const only = 1;\n',
    'src/b.ts': "import { a } from 'a';\nimport { c } from 'c';\nexport const b = a + c;\n",
  });
  const { repo, root } = workspace;

  const range = await readRange({ repo, from: root, to: root });

  expect(range.after.edges).toEqual([{ from: 'shop/file/b.ts', to: 'shop/file/lib/a.ts' }]);
});

test.for([
  {
    how: 'an alias climbing out',
    imported: '@/a',
    options: (repo: string) => ({ paths: { '@/*': [`${climbingTo(repo)}/*`] } }),
  },
  {
    how: 'a catch-all climbing out',
    imported: 'a',
    options: (repo: string) => ({ paths: { '*': [`${climbingTo(repo)}/*`] } }),
  },
  { how: 'an absolute place', imported: '@/a', options: () => ({ paths: { '@/*': ['/src/*'] } }) },
  {
    how: 'a baseUrl climbing out',
    imported: 'a',
    options: (repo: string) => ({ baseUrl: climbingTo(repo) }),
  },
  { how: 'an absolute baseUrl', imported: 'a', options: () => ({ baseUrl: '/src' }) },
])('a tsconfig path leaving the checkout is not read: $how', async ({ imported, options }) => {
  using workspace = gitRepo({
    'package.json': '{ "name": "shop" }\n',
    'src/a.ts': 'export const a = 1;\n',
    'src/b.ts': `import { a } from '${imported}';\nexport const b = a;\n`,
  });
  const { repo, root } = workspace;
  const compilerOptions = { rootDir: '.', ...options(repo) };
  const head = commit(repo, { 'tsconfig.json': JSON.stringify({ compilerOptions }) });
  writeFiles(repo, { 'outside/a.ts': 'export const a = 2;\n' });

  const range = await readRange({ repo, from: root, to: head });

  expect(range.after.edges).toEqual([]);
  expect(nodeIds(range.after)).toEqual([
    'shop',
    'shop/module/src',
    'shop/file/src/a.ts',
    'shop/file/src/b.ts',
  ]);
});

test.for([
  {
    how: 'through an alias',
    paths: { '@/*': ['./*'] },
    imported: (repo: string) => `@/${climbingTo(repo)}/a`,
  },
  {
    how: 'through a catch-all',
    paths: { '*': ['./*'] },
    imported: (repo: string) => `src/${climbingTo(repo)}/a`,
  },
  { how: 'by a relative climb', paths: {}, imported: (repo: string) => `${climbingTo(repo)}/a` },
  { how: 'by an absolute path', paths: {}, imported: (repo: string) => `${repo}/outside/a` },
])('a file outside the checkout is not drawn: $how', async ({ paths, imported }) => {
  using workspace = gitRepo({
    'package.json': '{ "name": "shop" }\n',
    'tsconfig.json': `${JSON.stringify({ compilerOptions: { rootDir: '.', paths } })}\n`,
    'src/b.ts': 'export const b = 1;\n',
  });
  const { repo, root } = workspace;
  const head = commit(repo, {
    'src/b.ts': `import { a } from '${imported(repo)}';\nexport const b = a;\n`,
  });
  writeFiles(repo, { 'outside/a.ts': 'export const a = 2;\n' });

  const range = await readRange({ repo, from: root, to: head });

  expect(range.after.edges).toEqual([]);
  expect(nodeIds(range.after)).toEqual(['shop', 'shop/module/src', 'shop/file/src/b.ts']);
});

test.for([
  { how: "from the checkout's root", root: '.', climb: '../../before/src/a' },
  { how: 'from a stack below it', root: 'apps/web', climb: '../../../../before/apps/web/src/a' },
])('the other side of the range, one climb away, is not drawn: $how', async ({ root, climb }) => {
  using workspace = gitRepo({
    [join(root, 'package.json')]: '{}\n',
    [join(root, 'tsconfig.json')]: '{ "compilerOptions": { "rootDir": "." } }\n',
    [join(root, 'src/a.ts')]: 'export const a = 1;\n',
    [join(root, 'src/b.ts')]: 'export const b = 1;\n',
  });
  const { repo, root: base } = workspace;
  const head = commit(repo, {
    [join(root, 'src/b.ts')]: `import { a } from '${climb}';\nexport const b = a;\n`,
  });

  const range = await readRange({ repo, from: base, to: head });

  expect(range.after.edges).toEqual([]);
});

test('a bare import of a sibling package, found in a node_modules above the checkout, joins its stack and draws no file', async () => {
  using above = gitRepo({
    'node_modules/@acme/lib/index.js': 'export const x = 1;\n',
    'tmp/keep': '',
  });
  vi.stubEnv('TMPDIR', join(above.repo, 'tmp'));
  using workspace = gitRepo({
    'apps/web/package.json': '{}\n',
    'apps/web/tsconfig.json': '{ "compilerOptions": { "rootDir": "." } }\n',
    'apps/web/src/b.ts': "import { x } from '@acme/lib';\nexport const b = x;\n",
    'packages/lib/package.json': '{ "name": "@acme/lib" }\n',
    'packages/lib/src/x.ts': 'export const x = 1;\n',
  });
  const { repo, root } = workspace;

  const range = await readRange({ repo, from: root, to: root });

  expect(range.after.edges).toEqual([{ from: 'apps/web/file/src/b.ts', to: 'packages/lib' }]);
  expect(nodeIds(range.after).filter(id => id.includes('node_modules'))).toEqual([]);
});

test.for([
  {
    how: 'a relative climb, from a stack whose source root is its folder',
    tsconfig: { compilerOptions: { rootDir: '.' } },
    imported: '../../lib/src/x',
    from: 'apps/web/file/src/b.ts',
  },
  {
    how: 'a tsconfig path, from a stack whose source root is its folder',
    tsconfig: { compilerOptions: { rootDir: '.', paths: { '@lib/*': ['../lib/src/*'] } } },
    imported: '@lib/x',
    from: 'apps/web/file/src/b.ts',
  },
  {
    how: 'a tsconfig path, from a stack with a src folder',
    tsconfig: { compilerOptions: { paths: { '@lib/*': ['../lib/src/*'] } } },
    imported: '@lib/x',
    from: 'apps/web/file/b.ts',
  },
])('$how joins the file to the sibling stack it lands in', async ({ tsconfig, imported, from }) => {
  using workspace = gitRepo({
    'apps/web/package.json': '{}\n',
    'apps/web/tsconfig.json': JSON.stringify(tsconfig),
    'apps/web/src/b.ts': `import { x } from '${imported}';\nexport const b = x;\n`,
    'apps/lib/package.json': '{}\n',
    'apps/lib/src/x.ts': 'export const x = 1;\n',
  });
  const { repo, root } = workspace;

  const range = await readRange({ repo, from: root, to: root });

  expect(range.after.edges).toEqual([{ from, to: 'apps/lib' }]);
  expect(nodeIds(range.after).filter(id => id.includes('..'))).toEqual([]);
});

test.for([
  {
    how: 'the deepest root holding it',
    place: './packages/lib/src/*',
    edges: [{ from: 'shop/file/b.ts', to: 'packages/lib' }],
  },
  {
    how: 'no root its folder name only begins like',
    place: './packages/library/src/*',
    edges: [],
  },
])('a path inside the root stack goes to $how', async ({ place, edges }) => {
  using workspace = gitRepo({
    'package.json': '{ "name": "shop" }\n',
    'tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '@/*': [place] } } }),
    'src/b.ts': "import { x } from '@/x';\nexport const b = x;\n",
    'packages/lib/package.json': '{}\n',
    'packages/lib/src/x.ts': 'export const x = 1;\n',
    'packages/library/src/x.ts': 'export const x = 1;\n',
  });
  const { repo, root } = workspace;

  const range = await readRange({ repo, from: root, to: root });

  expect(range.after.edges).toEqual(edges);
});

test('a relative climb to a file under no stack draws nothing', async () => {
  using workspace = gitRepo({
    'apps/web/package.json': '{}\n',
    'apps/web/tsconfig.json': '{ "compilerOptions": { "rootDir": "." } }\n',
    'apps/web/src/b.ts': "import { x } from '../../shared/x';\nexport const b = x;\n",
    'apps/shared/x.ts': 'export const x = 1;\n',
  });
  const { repo, root } = workspace;

  const range = await readRange({ repo, from: root, to: root });

  expect(range.after.edges).toEqual([]);
  expect(nodeIds(range.after).filter(id => id.includes('..'))).toEqual([]);
});

const aliasTo = (place: string) => ({ compilerOptions: { paths: { '@/*': [place] } } });

test.for([
  {
    how: 'a file named by a string',
    configs: { 'tsconfig.json': { extends: './base.json' }, 'base.json': aliasTo('./src/*') },
  },
  {
    how: 'a name without its extension',
    configs: { 'tsconfig.json': { extends: './base' }, 'base.json': aliasTo('./src/*') },
  },
  {
    how: 'an array, the later entry winning',
    configs: {
      'tsconfig.json': { extends: ['./one.json', './two.json'] },
      'one.json': aliasTo('./src/vendored/*'),
      'two.json': aliasTo('./src/*'),
    },
  },
  {
    how: 'a chain, the nearest winning',
    configs: {
      'tsconfig.json': { extends: './one.json' },
      'one.json': { extends: './two.json', ...aliasTo('./src/*') },
      'two.json': aliasTo('./src/vendored/*'),
    },
  },
  {
    how: 'its own paths ahead of what it extends',
    configs: {
      'tsconfig.json': { extends: './one.json', ...aliasTo('./src/*') },
      'one.json': aliasTo('./src/vendored/*'),
    },
  },
  {
    how: 'places relative to the config defining them',
    configs: {
      'tsconfig.json': { extends: './config/base' },
      'config/base.json': aliasTo('../src/*'),
    },
  },
  {
    how: 'a name relative to the config saying it',
    configs: {
      'tsconfig.json': { extends: './config/one' },
      'config/one.json': { extends: './two' },
      'config/two.json': aliasTo('../src/*'),
    },
  },
  {
    how: 'a climb that stays in the checkout',
    configs: {
      'tsconfig.json': { extends: './config/one' },
      'config/one.json': { extends: '../base' },
      'base.json': aliasTo('./src/*'),
    },
  },
  {
    how: 'places relative to an inherited baseUrl',
    configs: {
      'tsconfig.json': { extends: './config/base', ...aliasTo('./*') },
      'config/base.json': { compilerOptions: { baseUrl: '../src' } },
    },
  },
  {
    how: 'itself, which ends',
    configs: { 'tsconfig.json': { extends: './tsconfig.json', ...aliasTo('./src/*') } },
  },
  {
    how: 'in a cycle, which ends',
    configs: {
      'tsconfig.json': { extends: './one.json' },
      'one.json': { extends: './tsconfig.json', ...aliasTo('./src/*') },
    },
  },
  {
    how: 'a config two entries share, which counts for both',
    configs: {
      'tsconfig.json': { extends: ['./one.json', './two.json'] },
      'one.json': { extends: './shared.json', ...aliasTo('./src/vendored/*') },
      'two.json': { extends: './shared.json' },
      'shared.json': aliasTo('./src/*'),
    },
  },
  {
    how: 'a fan-out of thirty levels, read once a config',
    configs: {
      'tsconfig.json': { extends: ['./one-1.json', './two-1.json'] },
      ...Object.fromEntries(
        Array.from({ length: 30 }, (_, level) => level + 1).flatMap(level =>
          ['one', 'two'].map(side => [
            `${side}-${level}.json`,
            { extends: [`./one-${level + 1}.json`, `./two-${level + 1}.json`] },
          ]),
        ),
      ),
      'one-31.json': aliasTo('./src/*'),
    },
  },
])('a tsconfig extends $how', async ({ configs }) => {
  using workspace = gitRepo({
    'package.json': '{ "name": "shop" }\n',
    ...Object.fromEntries(
      Object.entries(configs).map(([file, config]) => [file, `${JSON.stringify(config)}\n`]),
    ),
    'src/lib/a.ts': 'export const a = 1;\n',
    'src/vendored/lib/a.ts': 'export const a = 2;\n',
    'src/b.ts': "import { a } from '@/lib/a';\nexport const b = a;\n",
  });
  const { repo, root } = workspace;

  const range = await readRange({ repo, from: root, to: root });

  expect(range.after.edges).toEqual([{ from: 'shop/file/b.ts', to: 'shop/file/lib/a.ts' }]);
});

test.for([
  { how: 'an absolute name', name: () => '/outside.json' },
  {
    how: 'a climb out of the checkout',
    name: (repo: string) => `${'../'.repeat(30)}${repo}/outside.json`,
  },
  { how: 'a package', name: () => 'outside' },
  { how: 'a package whose name climbs', name: () => 'package/../outside' },
])('a tsconfig extending $how reads nothing from it', async ({ name }) => {
  using workspace = gitRepo({
    'package.json': '{ "name": "shop" }\n',
    'mine.json': JSON.stringify(aliasTo('./src/*')),
    'outside.json': JSON.stringify({ compilerOptions: { paths: { '~/*': ['./src/*'] } } }),
    'src/a.ts': 'export const a = 1;\n',
    'src/b.ts': "import { a } from '@/a';\nexport const b = a;\n",
  });
  const { repo, root } = workspace;
  const head = commit(repo, {
    'tsconfig.json': JSON.stringify({ extends: ['./mine.json', name(repo)] }),
  });

  const range = await readRange({ repo, from: root, to: head });

  expect(range.after.edges).toEqual([{ from: 'shop/file/b.ts', to: 'shop/file/a.ts' }]);
});

test.for([
  { how: 'its rootDir', tsconfig: { compilerOptions: { rootDir: '..' } } },
  { how: 'its one included folder', tsconfig: { include: ['../**/*'] } },
])(
  'a stack whose source root climbs by $how, inside the checkout, is still drawn',
  async ({ tsconfig }) => {
    using workspace = gitRepo({
      'apps/web/package.json': '{ "name": "web" }\n',
      'apps/web/tsconfig.json': `${JSON.stringify(tsconfig)}\n`,
      'apps/web/a.ts': "import { x } from '../shared/x';\nexport const a = x;\n",
      'apps/shared/x.ts': 'export const x = 1;\n',
    });
    const { repo, root } = workspace;

    const range = await readRange({ repo, from: root, to: root });

    expect(range.after.edges).toEqual([
      { from: 'apps/web/file/web/a.ts', to: 'apps/web/file/shared/x.ts' },
    ]);
  },
);

test('a tsconfig extending a directory still reads its own paths', async () => {
  using workspace = gitRepo({
    'package.json': '{ "name": "shop" }\n',
    'tsconfig.json': JSON.stringify({ extends: './config.json', ...aliasTo('./src/*') }),
    'config.json/keep': '',
    'src/a.ts': 'export const a = 1;\n',
    'src/b.ts': "import { a } from '@/a';\nexport const b = a;\n",
  });
  const { repo, root } = workspace;

  const range = await readRange({ repo, from: root, to: root });

  expect(range.after.edges).toEqual([{ from: 'shop/file/b.ts', to: 'shop/file/a.ts' }]);
});

test.for([
  {
    how: 'its paths, as in the Vite template',
    configs: {
      'tsconfig.json': {
        files: [],
        references: [{ path: './tsconfig.app.json' }, { path: './tsconfig.node.json' }],
      },
      'tsconfig.app.json': aliasTo('./src/*'),
      'tsconfig.node.json': { compilerOptions: { composite: true } },
    },
  },
  {
    how: 'a folder, by the tsconfig.json in it',
    configs: {
      'tsconfig.json': { references: [{ path: './config' }] },
      'config/tsconfig.json': aliasTo('../src/*'),
    },
  },
  {
    how: 'nothing when its own chain holds paths',
    configs: {
      'tsconfig.json': { extends: './base.json', references: [{ path: './app.json' }] },
      'base.json': aliasTo('./src/*'),
      'app.json': aliasTo('./src/vendored/*'),
    },
  },
  {
    how: "its own baseUrl, ahead of the chain's",
    configs: {
      'tsconfig.json': {
        compilerOptions: { baseUrl: './src/vendored' },
        references: [{ path: './app.json' }],
      },
      'app.json': { compilerOptions: { baseUrl: './src', paths: { '@/*': ['./*'] } } },
    },
  },
])('a tsconfig reference brings $how', async ({ configs }) => {
  using workspace = gitRepo({
    'package.json': '{ "name": "shop" }\n',
    ...Object.fromEntries(
      Object.entries(configs).map(([file, config]) => [file, JSON.stringify(config)]),
    ),
    'src/lib/a.ts': 'export const a = 1;\n',
    'src/vendored/lib/a.ts': 'export const a = 2;\n',
    'src/b.ts': "import { a } from '@/lib/a';\nexport const b = a;\n",
  });
  const { repo, root } = workspace;

  const range = await readRange({ repo, from: root, to: root });

  expect(range.after.edges).toEqual([{ from: 'shop/file/b.ts', to: 'shop/file/lib/a.ts' }]);
});

test.for([
  { how: 'an absolute path', path: () => '/outside.json' },
  {
    how: 'a climb out of the checkout',
    path: (repo: string) => `${'../'.repeat(30)}${repo}/outside.json`,
  },
])('a tsconfig referencing $how reads nothing from it', async ({ path }) => {
  using workspace = gitRepo({
    'package.json': '{ "name": "shop" }\n',
    'mine.json': JSON.stringify(aliasTo('./src/*')),
    'outside.json': JSON.stringify({ compilerOptions: { paths: { '~/*': ['./src/*'] } } }),
    'src/a.ts': 'export const a = 1;\n',
    'src/b.ts': "import { a } from '@/a';\nexport const b = a;\n",
  });
  const { repo, root } = workspace;
  const head = commit(repo, {
    'tsconfig.json': JSON.stringify({
      references: [{ path: './mine.json' }, { path: path(repo) }],
    }),
  });

  const range = await readRange({ repo, from: root, to: head });

  expect(range.after.edges).toEqual([{ from: 'shop/file/b.ts', to: 'shop/file/a.ts' }]);
});

test('a very long tsconfig extends chain does not stop the review', async () => {
  using workspace = gitRepo({
    'package.json': '{ "name": "shop" }\n',
    'tsconfig.json': JSON.stringify({ extends: './level-1.json', ...aliasTo('./src/*') }),
    ...Object.fromEntries(
      Array.from({ length: 5000 }, (_, level) => [
        `level-${level + 1}.json`,
        JSON.stringify({ extends: `./level-${level + 2}.json` }),
      ]),
    ),
    'src/a.ts': 'export const a = 1;\n',
    'src/b.ts': "import { a } from '@/a';\nexport const b = a;\n",
  });
  const { repo, root } = workspace;

  const range = await readRange({ repo, from: root, to: root });

  expect(range.after.edges).toEqual([{ from: 'shop/file/b.ts', to: 'shop/file/a.ts' }]);
});

test('the nearest tsconfig paths replace what it extends wholly', async () => {
  using workspace = gitRepo({
    'package.json': '{ "name": "shop" }\n',
    'tsconfig.json': JSON.stringify({
      extends: './base.json',
      compilerOptions: { paths: { '~/*': ['./src/*'] } },
    }),
    'base.json': JSON.stringify(aliasTo('./src/*')),
    'src/a.ts': 'export const a = 1;\n',
    'src/b.ts': "import { a } from '@/a';\nexport const b = a;\n",
  });
  const { repo, root } = workspace;

  const range = await readRange({ repo, from: root, to: root });

  expect(range.after.edges).toEqual([]);
});

test('each stack and each side resolves through its own tsconfig paths', async () => {
  using workspace = gitRepo({
    'apps/one/package.json': '{}\n',
    'apps/one/tsconfig.json': '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }\n',
    'apps/one/src/a.ts': 'export const a = 1;\n',
    'apps/one/src/b.ts': "import { a } from '@/a';\nexport const b = a;\n",
    'apps/two/package.json': '{}\n',
    'apps/two/tsconfig.json': '{ "compilerOptions": { "paths": { "@/*": ["./src/lib/*"] } } }\n',
    'apps/two/src/lib/c.ts': 'export const c = 1;\n',
    'apps/two/src/d.ts': "import { c } from '@/c';\nexport const d = c;\n",
  });
  const { repo, root } = workspace;
  const head = commit(repo, {
    'apps/two/tsconfig.json': '{ "compilerOptions": { "paths": { "~/*": ["./src/lib/*"] } } }\n',
    'apps/two/src/d.ts': "import { c } from '~/c';\nexport const d = c;\n",
  });

  const range = await readRange({ repo, from: root, to: head });

  const edges = [
    { from: 'apps/one/file/b.ts', to: 'apps/one/file/a.ts' },
    { from: 'apps/two/file/d.ts', to: 'apps/two/file/lib/c.ts' },
  ];
  expect(range.before.edges).toEqual(edges);
  expect(range.after.edges).toEqual(edges);
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
    tsconfig: '{ "compilerOptions": { "rootDir": "lib", "paths": "not a map" } }',
    files: { 'lib/a.ts': 'export const a = 1;\n' },
    drawn: 'lib/a.ts',
  },
  {
    tsconfig: '{ "compilerOptions": { "rootDir": "lib", "baseUrl": 1 } }',
    files: { 'lib/a.ts': 'export const a = 1;\n' },
    drawn: 'lib/a.ts',
  },
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
  earlyReturns: 0,
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

test("each changed file of a stack whose reader reads symbols comes with its symbols' changes across the sides, a renamed file read at its former path, a file absent from one side having none there", async () => {
  using repository = gitRepo({ 'README.md': 'a shop\n' });
  const { repo } = repository;
  const base = commit(repo, {
    ...rootPackage,
    'src/index.ts': "import { a } from './a.ts';\n",
    'src/a.ts': 'export const a = () => 1;\n',
    'src/old.ts': 'export function kept() {}\n',
  });
  git(repo, 'mv', 'src/old.ts', 'src/new.ts');
  const head = commit(repo, {
    'src/a.ts': 'export const b = () => 1;\n',
    'src/c.ts': 'export function c() {}\n',
  });

  const range = await readRange({ repo, from: base, to: head });

  const stack = basename(repo);
  expect(range.symbols).toEqual([
    {
      node: `${stack}/file/a.ts`,
      stack,
      symbols: [
        {
          name: 'b',
          kind: 'function',
          lines: { base: { start: 1, end: 1 }, head: { start: 1, end: 1 } },
          exported: { base: true, head: true },
          change: 'renamed',
          renamedFrom: 'a',
        },
      ],
      exports: { added: ['b'], removed: ['a'] },
      kind: 'api',
    },
    {
      node: `${stack}/file/c.ts`,
      stack,
      symbols: [
        {
          name: 'c',
          kind: 'function',
          lines: { head: { start: 1, end: 1 } },
          exported: { head: true },
          change: 'added',
        },
      ],
      exports: { added: ['c'], removed: [] },
      kind: 'api',
    },
    {
      node: `${stack}/file/new.ts`,
      stack,
      symbols: [
        {
          name: 'kept',
          kind: 'function',
          lines: { base: { start: 1, end: 1 }, head: { start: 1, end: 1 } },
          exported: { base: true, head: true },
          change: 'unchanged',
        },
      ],
      exports: { added: [], removed: [] },
      kind: 'formatting',
    },
  ]);
  expect(range.symbolsNotRead).toEqual([]);
  expect(range.measuresNotRead).toEqual([]);
  expect(range.readers).toEqual(['typescript']);
});

test("a dropped stack's reader still counts among the range's readers", async () => {
  using repository = gitRepo({ 'visual-review.config.json': '{"stacks":{"shop":false}}\n' });
  const { repo, root } = repository;
  const head = commit(repo, { 'a.txt': 'changed\n' });
  const reader = fakeReader({ name: 'rails', roots: [{ root: '.', name: 'shop' }] });

  const range = await readRange({ repo, from: root, to: head, readers: [reader] });

  expect(range.readers).toEqual(['rails']);
});

test('a changed file of a stack whose reader reads neither symbols nor measures lists that stack as not read for both', async () => {
  using repository = gitRepo({ 'README.md': 'a shop\n' });
  const { repo, root } = repository;
  const head = commit(repo, { 'a.txt': 'a long enough line\n' });
  const reader = fakeReader({
    roots: [{ root: '.', name: 'shop' }],
    graph: async ({ directory, stack }) => ({
      nodes: [
        { id: stack, kind: 'stack', label: stack, path: '' },
        ...(existsSync(join(directory, 'a.txt'))
          ? [
              {
                id: `${stack}/file/a`,
                kind: 'file' as const,
                label: 'a',
                path: 'a.txt',
                parent: stack,
              },
            ]
          : []),
      ],
      edges: [],
    }),
  });

  const range = await readRange({ repo, from: root, to: head, readers: [reader] });

  expect(range.symbols).toEqual([]);
  expect(range.symbolsNotRead).toEqual(['shop']);
  expect(range.measuresNotRead).toEqual(['shop']);
});

test('a changed file whose symbols do not parse is listed with the parser message', async () => {
  using repository = gitRepo(rootPackage);
  const { repo, root } = repository;
  const head = commit(repo, { 'src/index.ts': 'export function (\n' });

  const range = await readRange({ repo, from: root, to: head });

  expect(range.symbols).toEqual([
    {
      node: `${basename(repo)}/file/index.ts`,
      stack: basename(repo),
      unreadable: expect.stringMatching(/\(1:16\)$/),
    },
  ]);
});

test('the files of a stack only one side has are read on that side', async () => {
  using repository = gitRepo({
    'admin/package.json': '{}\n',
    'admin/src/x.ts': 'export type X = 1;\n',
  });
  const { repo, root } = repository;
  git(repo, 'rm', '--quiet', '-r', 'admin');
  const head = commit(repo, {
    'shop/package.json': '{}\n',
    'shop/src/y.ts': 'export type Y = 2;\n',
  });

  const range = await readRange({ repo, from: root, to: head });

  expect(range.symbols).toEqual([
    {
      node: 'shop/file/y.ts',
      stack: 'shop',
      symbols: [
        {
          name: 'Y',
          kind: 'type',
          lines: { head: { start: 1, end: 1 } },
          exported: { head: true },
          change: 'added',
        },
      ],
      exports: { added: ['Y'], removed: [] },
      kind: 'api',
    },
    {
      node: 'admin/file/x.ts',
      stack: 'admin',
      symbols: [
        {
          name: 'X',
          kind: 'type',
          lines: { base: { start: 1, end: 1 } },
          exported: { base: true },
          change: 'removed',
        },
      ],
      exports: { added: [], removed: ['X'] },
      kind: 'api',
    },
  ]);
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

test.for([
  { name: 'a name git would quote', path: 'web/src/café.ts' },
  { name: 'a name git would read as pathspec magic', path: ':(exclude)a.ts' },
])('$name is listed as it is, with its own patch', { timeout: 60_000 }, async ({ path }) => {
  using workspace = cargoWorkspace();
  const { repo, root } = workspace;
  const to = commit(repo, { [path]: 'export const edited = 1;\n', 'web/src/a.ts': 'other\n' });

  const range = await readRange({ repo, from: root, to });

  expect(range.changedPaths).toContain(path);
  expect(range.patches.find(patch => patch.path === path)?.patch).toMatch(
    /\+export const edited = 1;$/,
  );
});

test('a renamed file whose names git would quote is one rename, listed by both', async () => {
  using workspace = cargoWorkspace();
  const { repo } = workspace;
  const from = commit(repo, { 'web/src/é.ts': 'export const same = 1;\n' });
  rmSync(join(repo, 'web/src/é.ts'));
  const to = commit(repo, { 'web/src/è.ts': 'export const same = 1;\n' });

  const range = await readRange({ repo, from, to });

  expect(range.renames).toEqual([{ from: 'web/src/é.ts', to: 'web/src/è.ts' }]);
}, 60_000);

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
      stack: 'rust',
      statements: [{ kind: 'test', name: 'rejects an unknown route', change: 'added' }],
    },
    {
      path: 'e2e/tests/home.spec.ts',
      stack: basename(repo),
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
      stack: basename(repo),
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

test('a changed test file names its stack, the deepest root of its reader holding it', async () => {
  using workspace = gitRepo({
    ...rootPackage,
    'admin/package.json': '{}\n',
    'admin/src/a.ts': '',
  });
  const { repo, root } = workspace;
  const to = commit(repo, {
    'src/index.test.ts': "test('reads the root', () => {});\n",
    'admin/src/a.test.ts': "test('reads a', () => {});\n",
  });

  const range = await readRange({ repo, from: root, to });

  expect(range.tests.map(({ path, stack }) => [path, stack])).toEqual([
    ['admin/src/a.test.ts', 'admin'],
    ['src/index.test.ts', basename(repo)],
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
      stack: basename(repo),
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
      stack: basename(repo),
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

test('a reviewed head reads as a side of its own, diffed plainly against the new head', async () => {
  using workspace = cargoWorkspace();
  const { repo, root } = workspace;
  const reviewed = commit(repo, {
    ...crateFiles('dropped'),
    'docs/old.md': 'a long enough line\n',
  });
  git(repo, 'reset', '--quiet', '--hard', root);
  const to = commit(repo, { 'docs/new.md': 'a long enough line\n' });

  const range = await readRange({
    repo,
    from: root,
    to,
    reviewed: reviewedHead({ head: reviewed, verdict: 'comment' }),
  });

  expect(range.reviewed).toEqual({
    ...reviewedHead({ head: reviewed }),
    commits: [{ sha: to, subject: 'docs/new.md', files: ['docs/new.md'] }],
    before: expect.objectContaining({
      nodes: expect.arrayContaining([expect.objectContaining({ id: 'rust/crate/dropped' })]),
    }),
    changedPaths: [
      'crates/dropped/Cargo.toml',
      'crates/dropped/src/lib.rs',
      'docs/old.md',
      'docs/new.md',
    ],
    renames: [{ from: 'docs/old.md', to: 'docs/new.md' }],
    symbols: [expect.objectContaining({ node: 'rust/mod/dropped/lib.rs', symbols: [] })],
    tests: [],
    pullRequest: {
      before: range.before,
      changedPaths: ['crates/dropped/Cargo.toml', 'crates/dropped/src/lib.rs', 'docs/old.md'],
      renames: [],
      symbols: [expect.objectContaining({ node: 'rust/mod/dropped/lib.rs', symbols: [] })],
      tests: [],
    },
  });
  expect(git(repo, 'worktree', 'list').split('\n')).toHaveLength(1);
});

test("a reviewed head holds the pull request's own diff from where it then forked, when the base branch has since been merged in", async () => {
  using workspace = cargoWorkspace();
  const { repo, root } = workspace;
  const reviewed = commit(repo, crateFiles('feature'));
  git(repo, 'reset', '--quiet', '--hard', root);
  const main = commit(repo, crateFiles('later'));
  git(repo, 'merge', '--quiet', '--no-edit', reviewed);
  const to = git(repo, 'rev-parse', 'HEAD');

  const range = await readRange({
    repo,
    from: main,
    to,
    reviewed: reviewedHead({ head: reviewed, verdict: 'comment' }),
  });

  expect(nodeIds(range.before)).toContain('rust/crate/later');
  expect(range.reviewed).toMatchObject({
    pullRequest: {
      before: {
        nodes: expect.not.arrayContaining([expect.objectContaining({ id: 'rust/crate/later' })]),
      },
      changedPaths: ['crates/feature/Cargo.toml', 'crates/feature/src/lib.rs'],
    },
  });
  expect(git(repo, 'worktree', 'list').split('\n')).toHaveLength(1);
});

test("a reviewed head holds the symbols and tests changed since it, and those of the pull request's own diff at it", async () => {
  using repository = gitRepo({
    ...rootPackage,
    'src/index.ts': "import './a.ts';\nimport './b.ts';\nimport './main.ts';\n",
    'src/a.ts': 'export const a = () => 1;\n',
    'src/b.ts': 'export const b = () => 1;\n',
    'src/c.ts': 'export const c = () => 1;\n',
    'src/main.ts': 'export const main = () => 1;\n',
    'src/a.test.ts': "test('one', () => { one(); });\n",
    'src/b.test.ts': "test('one', () => { one(); });\n",
  });
  const { repo, root } = repository;
  const head = commit(repo, {
    'src/a.ts': 'export const a = () => 2;\n',
    'src/b.ts': 'export const b = () => 2;\n',
    'src/a.test.ts': "test('one', () => { two(); });\n",
    'src/b.test.ts': "test('one', () => { two(); });\n",
  });
  git(repo, 'reset', '--quiet', '--hard', root);
  const main = commit(repo, { 'src/main.ts': 'export const main = () => 2;\n' });
  git(repo, 'merge', '--quiet', '--no-edit', head);
  const to = commit(repo, {
    'src/a.ts': 'export const a = () => 3;\n',
    'src/a.test.ts': "test('one', () => { three(); });\n",
    'src/b.ts': 'export const b = () => 1;\n',
    'src/c.ts': 'export const c = () => 2;\n',
  });

  const range = await readRange({
    repo,
    from: main,
    to,
    reviewed: reviewedHead({ head, verdict: 'comment' }),
  });

  const stack = basename(repo);
  const edited = (name: string) => [expect.objectContaining({ name, change: 'edited' })];
  const editedTest = (path: string) => ({
    path,
    renamedFrom: undefined,
    stack,
    statements: [{ kind: 'test', name: 'one', change: 'edited', label: undefined }],
  });
  expect(range.reviewed).toMatchObject({
    changedPaths: expect.arrayContaining(['src/main.ts']),
    symbols: [
      expect.objectContaining({ node: `${stack}/file/a.ts`, symbols: edited('a') }),
      expect.objectContaining({ node: `${stack}/file/b.ts`, symbols: edited('b') }),
      expect.objectContaining({ node: `${stack}/file/c.ts`, symbols: edited('c') }),
    ],
    tests: [editedTest('src/a.test.ts')],
    pullRequest: {
      symbols: [
        expect.objectContaining({ node: `${stack}/file/a.ts`, symbols: edited('a') }),
        expect.objectContaining({ node: `${stack}/file/b.ts`, symbols: edited('b') }),
      ],
      tests: [editedTest('src/a.test.ts'), editedTest('src/b.test.ts')],
    },
  });
});

test('a merge since the review reads no symbols of the files it adds or removes outside the pull request', async () => {
  using repository = gitRepo({
    ...rootPackage,
    'src/a.ts': 'export const a = () => 1;\n',
    'src/gone.ts': 'export const gone = () => 1;\n',
  });
  const { repo, root } = repository;
  const head = commit(repo, { 'src/a.ts': 'export const a = () => 2;\n' });
  git(repo, 'reset', '--quiet', '--hard', root);
  git(repo, 'rm', '--quiet', 'src/gone.ts');
  const main = commit(repo, { 'src/merged.ts': 'export const merged = () => 1;\n' });
  git(repo, 'merge', '--quiet', '--no-edit', head);
  const to = commit(repo, { 'src/a.ts': 'export const a = () => 3;\n' });

  const range = await readRange({
    repo,
    from: main,
    to,
    reviewed: reviewedHead({ head, verdict: 'comment' }),
  });

  expect(range.reviewed).toMatchObject({
    symbols: [expect.objectContaining({ node: `${basename(repo)}/file/a.ts` })],
  });
});

test('a reviewed head that no longer resolves is gone, and the range still reads', async () => {
  using workspace = cargoWorkspace();
  const { repo, root } = workspace;
  const to = commit(repo, crateFiles('cli'));
  const head = 'feedfacefeedfacefeedfacefeedfacefeedface';

  const range = await readRange({
    repo,
    from: root,
    to,
    reviewed: reviewedHead({ head, verdict: 'approve' }),
  });

  expect(range.reviewed).toMatchObject({ head, verdict: 'approve', gone: true });
  expect(nodeIds(range.after)).toContain('rust/crate/cli');
});

test('a reviewed head that exists but fails to read is unreadable, saying why, and the range still reads', async () => {
  using workspace = cargoWorkspace();
  const { repo, root } = workspace;
  const head = commit(repo, { 'crates/broken/Cargo.toml': 'not toml' });
  git(repo, 'reset', '--quiet', '--hard', root);
  const to = commit(repo, crateFiles('cli'));

  const range = await readRange({
    repo,
    from: root,
    to,
    reviewed: reviewedHead({ head, verdict: 'approve' }),
  });

  expect(range.reviewed).toMatchObject({
    head,
    verdict: 'approve',
    unreadable: expect.stringContaining('cargo metadata'),
  });
  expect(nodeIds(range.after)).toContain('rust/crate/cli');
  expect(git(repo, 'worktree', 'list').split('\n')).toHaveLength(1);
});

test('a reviewed head whose own fork point fails to read is unreadable too, and the range still reads', async () => {
  using workspace = cargoWorkspace();
  const { repo } = workspace;
  const broken = commit(repo, { 'crates/broken/Cargo.toml': 'not toml' });
  const fixed = crateFiles('broken');
  const head = commit(repo, { ...fixed, 'docs/mine.md': 'a long enough line\n' });
  git(repo, 'reset', '--quiet', '--hard', broken);
  const main = commit(repo, fixed);
  git(repo, 'merge', '--quiet', '--no-edit', head);
  const to = git(repo, 'rev-parse', 'HEAD');

  const range = await readRange({
    repo,
    from: main,
    to,
    reviewed: reviewedHead({ head, verdict: 'approve' }),
  });

  expect(range.reviewed).toMatchObject({
    head,
    verdict: 'approve',
    unreadable: expect.stringContaining('cargo metadata'),
  });
  expect(nodeIds(range.after)).toContain('rust/crate/broken');
});

test('the commits since the review each name their subject and files, a rename by both names, a non-ASCII name as it is, and a merge by none', async () => {
  using repository = gitRepo({ ...rootPackage, 'src/old.ts': 'a line long enough to rename\n' });
  const { repo, root } = repository;
  const head = commit(repo, { 'src/a.ts': 'export const a = 1;\n' });
  git(repo, 'checkout', '--quiet', '-b', 'main-moved', root);
  const fromMain = commit(repo, { 'docs/naïve name.md': 'moved on\n' });
  git(repo, 'checkout', '--quiet', '-');
  git(repo, 'mv', 'src/old.ts', 'src/new.ts');
  git(repo, 'commit', '--quiet', '--message', 'Rename\tit');
  const renamed = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'merge', '--quiet', '--no-edit', fromMain);
  const merge = git(repo, 'rev-parse', 'HEAD');

  const range = await readRange({
    repo,
    from: root,
    to: merge,
    reviewed: reviewedHead({ head }),
  });

  const commits = range.reviewed && 'commits' in range.reviewed ? range.reviewed.commits : [];
  expect(commits).toHaveLength(3);
  expect(commits).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ sha: merge, files: [] }),
      { sha: renamed, subject: 'Rename\tit', files: ['src/new.ts', 'src/old.ts'] },
      { sha: fromMain, subject: 'docs/naïve name.md', files: ['docs/naïve name.md'] },
    ]),
  );
});

test('no commits since a review of the same tree still reads as a comparable side', async () => {
  using repository = gitRepo({ ...rootPackage, 'src/a.ts': 'export const a = 1;\n' });
  const { repo, root } = repository;
  const to = commit(repo, { 'src/b.ts': 'export const b = 1;\n' });
  const ahead = commit(repo, { 'src/c.ts': 'export const c = 1;\n' });
  git(repo, 'reset', '--quiet', '--hard', to);

  const range = await readRange({ repo, from: root, to, reviewed: reviewedHead({ head: ahead }) });

  expect(range.reviewed).toMatchObject({ commits: [] });
});

const reachingScene = () => ({
  ...rootPackage,
  'src/a.ts':
    'export function foo() {}\nexport function lonely() {}\nexport function kept() {}\nexport const X = 1;\n',
  'src/uses.ts': "import { foo } from './a.ts';\nfoo();\n",
  'src/uses.test.ts': "import { foo } from './a.ts';\nfoo();\n",
  'src/changed.ts': "import { foo } from './a.ts';\nfoo();\n",
  'src/other.ts': "import { kept } from './a.ts';\nkept();\n",
  'src/barrel.ts': "export { foo } from './a.ts';\n",
  'src/early.ts': "import { foo } from './barrel.ts';\nfoo();\n",
});

test("a removed export reaches the files the range didn't change that still use it, tests last", async () => {
  using repository = gitRepo({ 'README.md': 'a shop\n' });
  const { repo } = repository;
  const base = commit(repo, reachingScene());
  const head = commit(repo, {
    'src/a.ts': 'export function kept() {}\nexport const X = 1;\n',
    'src/changed.ts': "import { foo } from './a.ts';\nfoo();\nfoo();\n",
  });

  const range = await readRange({ repo, from: base, to: head });

  const node = `${basename(repo)}/file/a.ts`;
  expect(range.reaches).toEqual([
    {
      node,
      id: `${node}#foo`,
      label: 'function foo',
      how: 'removed',
      uses: [
        { path: 'src/barrel.ts', line: 1, text: "export { foo } from './a.ts';" },
        { path: 'src/early.ts', line: 2, text: 'foo();' },
        { path: 'src/uses.ts', line: 2, text: 'foo();' },
        { path: 'src/uses.test.ts', line: 2, text: 'foo();', test: true },
      ],
    },
  ]);
});

test("a changed signature of an export reaches the files that use it, and a changed body doesn't", async () => {
  using repository = gitRepo({ 'README.md': 'a shop\n' });
  const { repo } = repository;
  const base = commit(repo, {
    ...rootPackage,
    'src/a.ts':
      'export function foo(a: string) {}\nexport function kept() {\n  return 1;\n}\nfunction own(a: string) {}\nown();\n',
    'src/uses.ts': "import { foo, kept, own } from './a.ts';\nfoo('x');\nkept();\nown();\n",
  });
  const head = commit(repo, {
    'src/a.ts':
      'export function foo(a: string, b: number) {}\nexport function kept() {\n  return 2;\n}\nfunction own(a: number) {}\nown();\n',
  });

  const range = await readRange({ repo, from: base, to: head });

  const node = `${basename(repo)}/file/a.ts`;
  expect(range.reaches).toEqual([
    {
      node,
      id: `${node}#foo`,
      label: 'function foo',
      how: 'signature changed',
      uses: [{ path: 'src/uses.ts', line: 2, text: "foo('x');" }],
    },
  ]);
});

test('a removed export no symbol backs reaches the files that use it, by its name', async () => {
  using repository = gitRepo({ 'README.md': 'a shop\n' });
  const { repo } = repository;
  const base = commit(repo, {
    ...rootPackage,
    'src/a.ts': 'export const X = 1;\nexport const kept = 2;\n',
    'src/uses.ts': "import { X } from './a.ts';\nconsole.log(X);\n",
  });
  const head = commit(repo, { 'src/a.ts': 'export const kept = 2;\n' });

  const range = await readRange({ repo, from: base, to: head });

  const node = `${basename(repo)}/file/a.ts`;
  expect(range.reaches).toEqual([
    {
      node,
      id: `${node}#X`,
      label: 'export X',
      how: 'removed',
      uses: [{ path: 'src/uses.ts', line: 2, text: 'console.log(X);' }],
    },
  ]);
});

test("a symbol's export name adds no row at a place the symbol already reached", async () => {
  using repository = gitRepo({ 'README.md': 'a shop\n' });
  const { repo } = repository;
  const base = commit(repo, {
    ...rootPackage,
    'src/a.ts': 'export default function App() {}\nexport const X = 1;\nexport const kept = 2;\n',
    'src/uses.ts': "import App, { X } from './a.ts';\nApp();\nconsole.log(X);\n",
    'src/other.ts': "import { X } from './a.ts';\nconsole.log(X);\n",
  });
  const head = commit(repo, { 'src/a.ts': 'export const kept = 2;\n' });

  const range = await readRange({ repo, from: base, to: head });

  const node = `${basename(repo)}/file/a.ts`;
  expect(range.reaches).toEqual([
    {
      node,
      id: `${node}#App`,
      label: 'function App',
      how: 'removed',
      uses: [{ path: 'src/uses.ts', line: 2, text: 'App();' }],
    },
    {
      node,
      id: `${node}#X`,
      label: 'export X',
      how: 'removed',
      uses: [
        { path: 'src/other.ts', line: 2, text: 'console.log(X);' },
        { path: 'src/uses.ts', line: 3, text: 'console.log(X);' },
      ],
    },
  ]);
});

test("a renamed file's removed export reaches through its name at the base", async () => {
  using repository = gitRepo({ 'README.md': 'a shop\n' });
  const { repo } = repository;
  const kept = Array.from({ length: 8 }, (_, index) => `export const kept${index} = ${index};\n`);
  const base = commit(repo, {
    ...rootPackage,
    'src/a.ts': `export function foo() {}\n${kept.join('')}`,
    'src/uses.ts': "import { foo } from './a.ts';\nfoo();\n",
  });
  git(repo, 'mv', 'src/a.ts', 'src/b.ts');
  const head = commit(repo, { 'src/b.ts': kept.join('') });

  const range = await readRange({ repo, from: base, to: head });

  const node = `${basename(repo)}/file/b.ts`;
  expect(range.renames).toEqual([{ from: 'src/a.ts', to: 'src/b.ts' }]);
  expect(range.reaches).toEqual([
    {
      node,
      id: `${node}#foo`,
      label: 'function foo',
      how: 'removed',
      uses: [{ path: 'src/uses.ts', line: 2, text: 'foo();' }],
    },
  ]);
});

test("an unchanged candidate that can't be read is named once, the other rows still there, and a changed one isn't", async () => {
  using repository = gitRepo({ 'README.md': 'a shop\n' });
  const { repo } = repository;
  const tooLong = `// ${'x'.repeat(1001)}\n`;
  const base = commit(repo, {
    ...rootPackage,
    'src/a.ts': 'export function foo() {}\nexport function bar() {}\nexport const kept = 2;\n',
    'src/b.ts': 'export function baz() {}\nexport const kept = 2;\n',
    'src/huge.ts': `import { foo } from './a.ts';\nimport { baz } from './b.ts';\n${tooLong}`,
    'src/uses.ts': "import { foo } from './a.ts';\nfoo();\n",
    'src/fixed.ts': "import { bar } from './a.ts';\nbar();\n",
  });
  const head = commit(repo, {
    'src/a.ts': 'export const kept = 2;\n',
    'src/b.ts': 'export const kept = 2;\n',
    'src/fixed.ts': `import { bar } from './a.ts';\n${tooLong}`,
  });

  const range = await readRange({ repo, from: base, to: head });

  expect(range.reaches.flatMap(({ uses }) => uses.map(({ path }) => path))).toEqual([
    'src/uses.ts',
  ]);
  expect(range.reachesNotRead).toEqual(['not read: src/huge.ts', NOT_DRAWN]);
});

test('a file renamed from what its reader cannot parse has nothing to ask, so is not read for its names', async () => {
  using repository = gitRepo({ 'README.md': 'a shop\n' });
  const { repo } = repository;
  const values = '"a": 1,\n"b": 2,\n"c": 3,\n"d": 4,\n"e": 5,\n"f": 6,\n"g": 7,\n"h": 8\n';
  const base = commit(repo, {
    ...rootPackage,
    'src/data.json': `{\n${values}}\n`,
    'src/uses.ts': "import data from './data.json';\nexport const a = data;\n",
  });
  git(repo, 'mv', 'src/data.json', 'src/data.ts');
  const head = commit(repo, {
    'src/data.ts': `export default {\n${values}};\n`,
    'src/uses.ts': "import data from './data.ts';\nexport const a = data;\n",
  });

  const range = await readRange({ repo, from: base, to: head });

  expect(range.renames).toEqual([{ from: 'src/data.json', to: 'src/data.ts' }]);
  expect(range.reaches).toEqual([]);
});

test("a removed method isn't asked about by itself", async () => {
  using repository = gitRepo({ 'README.md': 'a shop\n' });
  const { repo } = repository;
  const base = commit(repo, {
    ...rootPackage,
    'src/a.ts': 'export class Foo {\n  bar() {}\n  baz() {}\n}\n',
    'src/passes.ts': "import * as a from './a.ts';\nconsole.log(a);\n",
  });
  const head = commit(repo, { 'src/a.ts': 'export class Foo {\n  baz() {}\n}\n' });

  const range = await readRange({ repo, from: base, to: head });

  expect(range.reaches).toEqual([]);
  expect(range.reachesNotRead).toEqual(['methods not followed']);
});

test('a removed method beside a removed function still says methods are not followed', async () => {
  using repository = gitRepo({ 'README.md': 'a shop\n' });
  const { repo } = repository;
  const base = commit(repo, {
    ...rootPackage,
    'src/a.ts': 'export class Foo {\n  bar() {}\n  baz() {}\n}\nexport function gone() {}\n',
  });
  const head = commit(repo, { 'src/a.ts': 'export class Foo {\n  baz() {}\n}\n' });

  const range = await readRange({ repo, from: base, to: head });

  expect(range.reachesNotRead).toEqual(['methods not followed', NOT_DRAWN]);
});

test.for([
  {
    reason: 'a method whose body changed',
    a: 'export class Foo {\n  bar() {\n    return 2;\n  }\n}\n',
  },
  {
    reason: 'a method of a class never exported',
    from: 'class Foo {\n  bar() {}\n  baz() {}\n}\nexport const f = Foo;\n',
    a: 'class Foo {\n  baz() {}\n}\nexport const f = Foo;\n',
  },
  {
    reason: 'a class removed whole, which is followed by its own name',
    a: 'export const other = 1;\n',
    lacks: [NOT_DRAWN],
  },
])('$reason leaves methods out of what blast radius lacks', async ({ from, a, lacks }) => {
  using repository = gitRepo({ 'README.md': 'a shop\n' });
  const { repo } = repository;
  const base = commit(repo, {
    ...rootPackage,
    'src/a.ts': from ?? 'export class Foo {\n  bar() {\n    return 1;\n  }\n}\n',
  });
  const head = commit(repo, { 'src/a.ts': a });

  const range = await readRange({ repo, from: base, to: head });

  expect(range.reachesNotRead).toEqual(lacks ?? []);
});

test("a changed file of a stack whose reader follows no uses says so, and a stack the base doesn't hold has nothing to follow", async () => {
  using repository = gitRepo({
    'config/application.rb': 'module Shop\n  class Application\n  end\nend\n',
    'app/models/order.rb': 'class Order\n  def total\n    1\n  end\nend\n',
  });
  const { repo, root } = repository;
  const head = commit(repo, {
    'app/models/order.rb': 'class Order\n  def total\n    2\n  end\nend\n',
    'web/package.json': '{}\n',
    'web/src/a.ts': 'export const a = 1;\n',
  });

  const range = await readRange({ repo, from: root, to: head });

  expect(range.reachesNotRead).toEqual([`not read for ${basename(repo)}`]);
});

const twoStacks = {
  'web/package.json': '{}\n',
  'web/src/a.ts': 'export function foo() {}\nexport function kept() {}\n',
  'lib/package.json': '{}\n',
  'lib/src/index.ts': 'export const lib = 1;\n',
};

test("a name asked in a repo of several stacks says other stacks aren't followed", async () => {
  using repository = gitRepo(twoStacks);
  const { repo, root } = repository;
  const head = commit(repo, { 'web/src/a.ts': 'export function kept() {}\n' });

  const range = await readRange({ repo, from: root, to: head });

  expect(range.reachesNotRead).toEqual(['other stacks not followed', NOT_DRAWN]);
});

test.for([
  {
    reason: 'nothing asked',
    files: { 'web/src/a.ts': 'export function foo() {}\nexport function kept() { return 1; }\n' },
    config: {},
    lacks: [],
  },
  {
    reason: 'the other stack dropped',
    files: { 'web/src/a.ts': 'export function kept() {}\n' },
    config: { 'visual-review.config.json': '{"stacks":{"lib":false}}\n' },
    lacks: [NOT_DRAWN],
  },
])('$reason says no other stack is left to follow', async ({ files, config, lacks }) => {
  using repository = gitRepo({ ...twoStacks, ...config });
  const { repo, root } = repository;
  const head = commit(repo, files);

  const range = await readRange({ repo, from: root, to: head });

  expect(range.reachesNotRead).toEqual(lacks);
});

test.for([
  {
    reason: 'renamed',
    head: { 'src/a.ts': 'export function bar() {\n  return 42;\n}\nexport const kept = 1;\n' },
    how: 'renamed to bar',
  },
  {
    reason: 'no longer exported',
    head: { 'src/a.ts': 'function foo() {\n  return 42;\n}\nexport const kept = foo();\n' },
    how: 'no longer exported',
  },
  {
    reason: 'moved away',
    head: {
      'src/a.ts': 'export const kept = 1;\n',
      'src/b.ts': 'export function foo() {\n  return 42;\n}\n',
    },
    how: 'moved to src/b.ts',
  },
])('a symbol $reason is asked by its former name', async ({ head, how }) => {
  using repository = gitRepo({ 'README.md': 'a shop\n' });
  const { repo } = repository;
  const base = commit(repo, {
    ...rootPackage,
    'src/a.ts': 'export function foo() {\n  return 42;\n}\nexport const kept = 1;\n',
    'src/uses.ts': "import { foo } from './a.ts';\nfoo();\n",
  });

  const range = await readRange({ repo, from: base, to: commit(repo, head) });

  expect(range.reaches).toEqual([
    expect.objectContaining({
      label: 'function foo',
      how,
      uses: [{ path: 'src/uses.ts', line: 2, text: 'foo();' }],
    }),
  ]);
});

test('a file the range deletes reaches those still importing it, and a type by its type import', async () => {
  using repository = gitRepo({ 'README.md': 'a shop\n' });
  const { repo } = repository;
  const base = commit(repo, {
    ...rootPackage,
    'src/a.ts': 'export type Foo = number;\n',
    'src/uses.ts': "import type { Foo } from './a.ts';\nexport const x: Foo = 1;\n",
  });
  rmSync(join(repo, 'src/a.ts'));

  const range = await readRange({
    repo,
    from: base,
    to: commit(repo, { 'README.md': 'a shop.\n' }),
  });

  expect(range.reaches).toEqual([
    expect.objectContaining({
      label: 'type Foo',
      how: 'removed',
      uses: [{ path: 'src/uses.ts', line: 2, text: 'export const x: Foo = 1;' }],
    }),
  ]);
});

test("a removed star re-export says it isn't followed, as its names can't be told", async () => {
  using repository = gitRepo({ 'README.md': 'a shop\n' });
  const { repo } = repository;
  const base = commit(repo, {
    ...rootPackage,
    'src/x.ts': 'export const fromX = 1;\n',
    'src/barrel.ts': "export * from './x.ts';\nexport const kept = 1;\n",
    'src/user.ts': "import { fromX } from './barrel.ts';\nfromX;\n",
  });
  const head = commit(repo, { 'src/barrel.ts': 'export const kept = 1;\n' });

  const range = await readRange({ repo, from: base, to: head });

  expect(range.reaches).toEqual([]);
  expect(range.reachesNotRead).toEqual([NOT_DRAWN, 'removed export * not followed']);
});

test("a reader's uses that throws is kept as not read, and the review goes on", async () => {
  using repository = gitRepo({ 'README.md': 'a shop\n' });
  const { repo } = repository;
  const base = commit(repo, {
    ...rootPackage,
    'src/a.ts': 'export function foo() {}\nexport const kept = 1;\n',
  });
  const head = commit(repo, { 'src/a.ts': 'export const kept = 1;\n' });
  const uses = async () => {
    throw new Error('boom');
  };

  const range = await readRange({
    repo,
    from: base,
    to: head,
    readers: [{ ...typeScriptReader, uses }],
  });

  expect(range.reaches).toEqual([]);
  expect(range.reachesNotRead).toEqual([`not read for ${basename(repo)}: Error: boom`]);
});

test('another stack of a reader that reads another language is no stack to follow', async () => {
  using repository = gitRepo({
    'web/package.json': twoStacks['web/package.json'],
    'web/src/a.ts': twoStacks['web/src/a.ts'],
    'config/application.rb': 'module Shop\n  class Application\n  end\nend\n',
    'app/models/order.rb': 'class Order\nend\n',
  });
  const { repo, root } = repository;
  const head = commit(repo, { 'web/src/a.ts': 'export function kept() {}\n' });

  const range = await readRange({ repo, from: root, to: head });

  expect(range.reachesNotRead).toEqual([NOT_DRAWN]);
});

const usesFoo = (imported: string) => `import { foo } from '${imported}';\nfoo();\n`;

test.for([
  {
    how: 'a wildcard',
    paths: { '@/*': ['./src/*'] },
    imported: '@/lib/a',
  },
  {
    how: 'an exact name',
    paths: { 'the-lib': ['./src/lib/a.ts'] },
    imported: 'the-lib',
  },
  {
    how: 'a later place, when the first holds no file',
    paths: { '@/*': ['./gone/*', './src/*'] },
    imported: '@/lib/a',
  },
  {
    how: 'the longest prefix, written last',
    paths: { '@/*': ['./gone/*'], '@/lib/*': ['./src/lib/*'] },
    imported: '@/lib/a',
  },
  {
    how: 'a catch-all',
    paths: { '*': ['./src/*'] },
    imported: 'lib/a',
  },
  {
    how: 'a suffix',
    paths: { '@/*-gen': ['./src/*'] },
    imported: '@/lib/a-gen',
  },
  {
    how: 'a baseUrl, past paths that do not match',
    paths: { '@/*': ['./gone/*'], 'lib/*-gen': ['./gone/*'], other: ['./gone/other.ts'] },
    baseUrl: './src',
    imported: 'lib/a',
  },
])(
  'an unchanged file importing through $how still reaches',
  async ({ paths, baseUrl, imported }) => {
    using repository = gitRepo({ 'README.md': 'a shop\n' });
    const { repo } = repository;
    const base = commit(repo, {
      'apps/web/package.json': '{}\n',
      'apps/web/tsconfig.json': JSON.stringify({ compilerOptions: { paths, baseUrl } }),
      'apps/web/src/lib/a.ts': 'export function foo() {}\nexport const kept = 1;\n',
      'apps/web/src/uses.ts': usesFoo(imported),
    });
    const head = commit(repo, { 'apps/web/src/lib/a.ts': 'export const kept = 1;\n' });

    const range = await readRange({ repo, from: base, to: head });

    expect(range.reaches.flatMap(({ uses }) => uses)).toEqual([
      { path: 'apps/web/src/uses.ts', line: 2, text: 'foo();' },
    ]);
  },
);

test('an import through a tsconfig path names only the first place holding a file', async () => {
  using repository = gitRepo({ 'README.md': 'a shop\n' });
  const { repo } = repository;
  const base = commit(repo, {
    ...rootPackage,
    'tsconfig.json': JSON.stringify({
      compilerOptions: { paths: { '@/*': ['./src/one/*', './src/two/*'] } },
    }),
    'src/one/a.ts': 'export function foo() {}\n',
    'src/two/a.ts': 'export function foo() {}\nexport const kept = 1;\n',
    'src/uses.ts': `${usesFoo('@/a')}import { kept } from './two/a';\nkept;\n`,
  });
  const head = commit(repo, { 'src/two/a.ts': 'export const kept = 1;\n' });

  const range = await readRange({ repo, from: base, to: head });

  expect(range.reaches).toEqual([]);
});

test('what asks a name says what the graph holds no edge for, which reads no row: a type-only re-export, a test outside the source root', async () => {
  using repository = gitRepo({ 'README.md': 'a shop\n' });
  const { repo } = repository;
  const base = commit(repo, {
    ...rootPackage,
    'src/a.ts': 'export function foo() {}\nexport type Foo = number;\nexport const kept = 1;\n',
    'src/types.ts': "export type { Foo } from './a.ts';\n",
    'test/a.test.ts': "import { foo } from '../src/a.ts';\nfoo();\n",
  });
  const head = commit(repo, { 'src/a.ts': 'export const kept = 1;\n' });

  const range = await readRange({ repo, from: base, to: head });

  expect(range.reaches).toEqual([]);
  expect(range.reachesNotRead).toEqual([NOT_DRAWN]);
});
