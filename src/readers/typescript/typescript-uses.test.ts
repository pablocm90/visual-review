import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import type { Graph } from '../../core/graph.ts';
import { writeFiles } from '../../test-support/repos.ts';
import { typeScriptReader } from './reader.ts';

const idOf = (path: string) => `web/file/${path}`;

const graphOf = (files: ReadonlyArray<string>, edges: ReadonlyArray<string>): Graph => ({
  nodes: files.map(path => ({ id: idOf(path), kind: 'file', label: path, path: `src/${path}` })),
  edges: edges.map(edge => {
    const [from = '', to = ''] = edge.split(' -> ');
    return { from: idOf(from), to: idOf(to) };
  }),
});

type Scene = {
  readonly files: Readonly<Record<string, string>>;
  readonly edges: ReadonlyArray<string>;
  readonly names: ReadonlyArray<string>;
};

const usesIn = async ({ files, edges, names }: Scene) => {
  const directory = mkdtempSync(join(tmpdir(), 'visual-review-uses-'));
  try {
    writeFiles(
      directory,
      Object.fromEntries(Object.entries(files).map(([path, text]) => [`src/${path}`, text])),
    );
    return await typeScriptReader.uses?.({
      base: directory,
      head: directory,
      graph: graphOf(Object.keys(files), edges),
      node: idOf('a.ts'),
      names,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

test('a file importing a name uses it where it first calls it, or at the import if it never does', async () => {
  const reading = await usesIn({
    files: {
      'a.ts': 'export const foo = 1;\nexport const bar = 2;\nexport const baz = 3;\n',
      'b.ts':
        "import { foo, bar as renamed } from './a';\nother.foo;\n  foo(1);\nfoo(2);\nrenamed();\n",
      'c.ts': "import { foo } from './a';\nrun();\n",
    },
    edges: ['b.ts -> a.ts', 'c.ts -> a.ts'],
    names: ['foo', 'bar', 'baz'],
  });
  expect(reading?.uses).toEqual({
    foo: [
      { path: 'src/b.ts', line: 3, text: 'foo(1);' },
      { path: 'src/c.ts', line: 1, text: "import { foo } from './a';" },
    ],
    bar: [{ path: 'src/b.ts', line: 5, text: 'renamed();' }],
    baz: [],
  });
});
