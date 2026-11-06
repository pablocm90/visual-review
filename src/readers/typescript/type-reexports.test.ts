import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { writeFiles } from '../../test-support/repos.ts';
import { typeScriptReader } from './reader.ts';

const edgesIn = async (files: Readonly<Record<string, string>>) => {
  const checkout = mkdtempSync(join(tmpdir(), 'visual-review-type-reexports-'));
  try {
    writeFiles(checkout, { 'package.json': '{"name":"web"}', ...files });
    const { edges } = await typeScriptReader.graph({
      directory: checkout,
      root: '.',
      stack: 'web',
      settings: {},
      stacks: new Map([['.', 'web']]),
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

test('a file that does not parse draws no type edge, and the rest of the graph is read', async () => {
  const edges = await edgesIn({
    'src/a.ts': 'export type Foo = string;\n',
    'src/broken.ts': "export type { Foo } from './a';\nconst = ;\n",
    'src/types.ts':
      "import { readFile } from 'node:fs';\nexport type { Foo } from './a';\nexport const read = readFile;\n",
  });

  expect(edges).toEqual([{ from: 'web/file/types.ts', to: 'web/file/a.ts' }]);
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
