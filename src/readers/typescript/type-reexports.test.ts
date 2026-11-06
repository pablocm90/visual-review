import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import type { Graph } from '../../core/graph.ts';
import { writeFiles } from '../../test-support/repos.ts';
import { typeScriptReader } from './reader.ts';
import { resolutionIn } from './typescript-config.ts';
import { withTypeReexports } from './typescript-type-reexports.ts';
import { CruiseOutputSchema } from './web-graph.ts';

type Layout = {
  readonly root: string;
  readonly stacks: ReadonlyArray<readonly [string, string]>;
};

const graphIn = async (
  files: Readonly<Record<string, string>>,
  { root, stacks }: Layout = { root: '.', stacks: [['.', 'web']] },
) => {
  const checkout = mkdtempSync(join(tmpdir(), 'visual-review-type-reexports-'));
  try {
    writeFiles(checkout, { 'package.json': '{"name":"repo"}', ...files });
    return await typeScriptReader.graph({
      directory: checkout,
      root,
      stack: 'web',
      settings: {},
      stacks: new Map(stacks),
    });
  } finally {
    rmSync(checkout, { recursive: true, force: true });
  }
};

const edgesIn = async (
  files: Readonly<Record<string, string>>,
  layout?: Layout,
): Promise<Graph['edges']> => (await graphIn(files, layout)).edges;

test.for([
  { form: 'export type { … } from', text: "export type { Foo } from './a';\n" },
  { form: 'export type * from', text: "export type * from './a';\n" },
])('$form draws the edge to the file it names', async ({ text }) => {
  const edges = await edgesIn({
    'src/a.ts': 'export type Foo = string;\n',
    'src/types.ts': text,
  });

  expect(edges).toEqual([{ from: 'web/file/types.ts', to: 'web/file/a.ts' }]);
});

test('an aliased type re-export draws the edge to the file the alias names', async () => {
  const edges = await edgesIn({
    'tsconfig.json': '{"compilerOptions":{"paths":{"@/*":["./missing/*","./src/*"]}}}',
    'src/a.ts': 'export type Foo = string;\n',
    'src/types.ts': "export type { Foo } from '@/a';\n",
  });

  expect(edges).toEqual([{ from: 'web/file/types.ts', to: 'web/file/a.ts' }]);
});

test.for([
  {
    how: 'by a package name the running tool also has installed',
    specifier: 'zod',
  },
  {
    how: 'by a relative path',
    specifier: '../../lib/src/a',
  },
  {
    how: 'by an alias',
    specifier: '@lib/a',
  },
  {
    how: "by a folder's index",
    specifier: '../../lib/src/inner',
  },
])('a type re-export into a sibling stack, $how, draws the edge to it', async ({ specifier }) => {
  const edges = await edgesIn(
    {
      'web/package.json': '{"name":"web"}',
      'web/tsconfig.json': '{"compilerOptions":{"paths":{"@lib/*":["../lib/src/*"]}}}',
      'web/src/types.ts': `export type { Foo } from '${specifier}';\n`,
      'lib/package.json': '{"name":"zod"}',
      'lib/src/a.ts': 'export type Foo = string;\n',
      'lib/src/inner/index.ts': 'export type Foo = string;\n',
    },
    {
      root: 'web',
      stacks: [
        ['web', 'web'],
        ['lib', 'lib'],
      ],
    },
  );

  expect(edges).toEqual([{ from: 'web/file/types.ts', to: 'lib' }]);
});

test('a type re-export of a name both a file and a folder hold draws to the file, as an import does', async () => {
  const edges = await edgesIn({
    'src/x.ts': 'export type Foo = string;\n',
    'src/x/index.ts': 'export type Foo = number;\n',
    'src/types.ts': "export type { Foo } from './x';\n",
  });

  expect(edges).toEqual([{ from: 'web/file/types.ts', to: 'web/file/x.ts' }]);
});

test('a type re-export writing its extension draws to that file, though another ending comes first', async () => {
  const edges = await edgesIn({
    'src/x.ts': 'export type A = string;\n',
    'src/x.tsx': 'export type A = number;\n',
    'src/types.ts': "export type { A } from './x.tsx';\n",
  });

  expect(edges).toEqual([{ from: 'web/file/types.ts', to: 'web/file/x.tsx' }]);
});

test('a type re-export of a file the cruise holds and no script ending names draws its edge', async () => {
  const edges = await edgesIn({
    'src/a.ts': "import C from './c.vue';\nexport const y = C;\n",
    'src/c.vue': '<template />\n',
    'src/types.ts': "export type { Props } from './c.vue';\n",
  });

  expect(edges).toEqual([
    { from: 'web/file/a.ts', to: 'web/file/c.vue' },
    { from: 'web/file/types.ts', to: 'web/file/c.vue' },
  ]);
});

test('a package name an import left unresolved still reaches its sibling, from both files', async () => {
  const edges = await edgesIn(
    {
      'web/package.json': '{"name":"web"}',
      'web/tsconfig.json': '{"compilerOptions":{"baseUrl":"."}}',
      'web/src/a.ts': "import { x } from '@acme/lib';\nexport const y = x;\n",
      'web/src/types.ts': "export type { T } from '@acme/lib';\n",
      'lib/package.json': '{"name":"@acme/lib"}',
      'lib/src/index.ts': 'export const x = 1;\n',
    },
    {
      root: 'web',
      stacks: [
        ['web', 'web'],
        ['lib', 'lib'],
      ],
    },
  );

  expect(edges).toEqual([
    { from: 'web/file/a.ts', to: 'lib' },
    { from: 'web/file/types.ts', to: 'lib' },
  ]);
});

test.for([
  {
    what: 'a package an import also names',
    tsconfig: '{"compilerOptions":{"baseUrl":".","rootDir":"."}}',
    named: 'zod',
  },
  {
    what: 'a path an import also names and nothing holds',
    tsconfig: '{"compilerOptions":{"rootDir":"."}}',
    named: './gone',
  },
])('a type re-export of $what draws no node for it', async ({ tsconfig, named }) => {
  const { nodes } = await graphIn({
    'tsconfig.json': tsconfig,
    'a.ts': `import { z } from '${named}';\nexport const y = z;\n`,
    'types.ts': `export type { Z } from '${named}';\n`,
  });

  expect(nodes.map(({ id }) => id).toSorted()).toEqual([
    'web',
    'web/file/a.ts',
    'web/file/types.ts',
  ]);
});

test('a type re-export naming no file in a sibling stack draws nothing', async () => {
  const edges = await edgesIn(
    {
      'web/package.json': '{"name":"web"}',
      'web/src/types.ts': "export type { Foo } from '../../lib/src/gone';\n",
      'lib/package.json': '{"name":"@acme/lib"}',
      'lib/src/a.ts': 'export type Foo = string;\n',
    },
    {
      root: 'web',
      stacks: [
        ['web', 'web'],
        ['lib', 'lib'],
      ],
    },
  );

  expect(edges).toEqual([]);
});

test('a file that does not parse draws no type edge, and the rest of the graph is read', async () => {
  const edges = await edgesIn({
    'src/a.ts': 'export type Foo = string;\n',
    'src/broken.ts': "export type { Foo } from './a';\nconst = ;\n",
    'src/types.ts':
      "import { readFile } from 'node:fs';\nexport type { Foo } from './a';\nexport const read = readFile;\n",
  });

  expect(edges).toEqual([{ from: 'web/file/types.ts', to: 'web/file/a.ts' }]);
});

test('a file over the size limit is not parsed for its type re-exports', async () => {
  const edges = await edgesIn({
    'src/a.ts': 'export type Foo = string;\n',
    'src/big.ts': `export type { Foo } from './a';\n${'// filler\n'.repeat(200_000)}`,
  });

  expect(edges).toEqual([]);
});

test('an inline type re-export and a local one draw what they did', async () => {
  const edges = await edgesIn({
    'src/a.ts': 'export type Foo = string;\n',
    'src/index.ts': 'export const x = 1;\n',
    'src/inline.ts': "export { type Foo } from './a';\n",
    'src/local.ts': "type Bar = string;\nexport type { Bar };\nexport type * from './gone';\n",
  });

  expect(edges).toEqual([{ from: 'web/file/inline.ts', to: 'web/file/a.ts' }]);
});

test("a module the cruise found outside the checkout isn't read for its type re-exports", () => {
  const parent = mkdtempSync(join(tmpdir(), 'visual-review-type-reexports-'));
  try {
    writeFiles(parent, {
      'leaves.ts': "export type { Foo } from './checkout/src/a';\n",
      'checkout/src/a.ts': 'export type Foo = string;\n',
    });
    const checkout = join(parent, 'checkout');

    const { modules } = CruiseOutputSchema.parse(
      JSON.parse(
        withTypeReexports({
          cruiseJson: JSON.stringify({ modules: [{ source: '../leaves.ts', dependencies: [] }] }),
          checkout,
          root: '.',
          resolution: resolutionIn({ checkout, root: '.' }),
        }),
      ),
    );

    expect(modules).toEqual([{ source: '../leaves.ts', dependencies: [] }]);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
