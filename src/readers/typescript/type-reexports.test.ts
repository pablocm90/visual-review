import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { writeFiles } from '../../test-support/repos.ts';
import { typeScriptReader } from './reader.ts';

type Layout = {
  readonly root: string;
  readonly stacks: ReadonlyArray<readonly [string, string]>;
};

const edgesIn = async (
  files: Readonly<Record<string, string>>,
  { root, stacks }: Layout = { root: '.', stacks: [['.', 'web']] },
) => {
  const checkout = mkdtempSync(join(tmpdir(), 'visual-review-type-reexports-'));
  try {
    writeFiles(checkout, { 'package.json': '{"name":"repo"}', ...files });
    const { edges } = await typeScriptReader.graph({
      directory: checkout,
      root,
      stack: 'web',
      settings: {},
      stacks: new Map(stacks),
    });
    return edges;
  } finally {
    rmSync(checkout, { recursive: true, force: true });
  }
};

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
