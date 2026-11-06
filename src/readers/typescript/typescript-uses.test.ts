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
  readonly target?: string;
};

const usesIn = async ({ files, edges, names, target = 'a.ts' }: Scene) => {
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
      node: idOf(target),
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

test.for([
  { specifier: './other', importer: 'b.ts', target: 'a.ts', counts: false },
  { specifier: '../a', importer: 'sub/b.ts', target: 'a.ts', counts: true },
  { specifier: './a', importer: 'sub/b.ts', target: 'a.ts', counts: false },
  { specifier: './a.js', importer: 'b.ts', target: 'a.ts', counts: true },
  { specifier: './lib', importer: 'b.ts', target: 'lib/index.ts', counts: true },
  { specifier: './lib/index', importer: 'b.ts', target: 'lib/index.ts', counts: true },
  { specifier: './', importer: 'lib/b.ts', target: 'lib/index.ts', counts: true },
  { specifier: '.', importer: 'b.ts', target: 'index.ts', counts: true },
  { specifier: '@/lib/a', importer: 'b.ts', target: 'a.ts', counts: true },
  { specifier: '@/lib/a.js', importer: 'b.ts', target: 'a.ts', counts: true },
  { specifier: '@/lib/other', importer: 'b.ts', target: 'a.ts', counts: false },
  { specifier: '@/lib', importer: 'b.ts', target: 'lib/index.ts', counts: true },
])(
  '$specifier in $importer is $target: $counts',
  async ({ specifier, importer, target, counts }) => {
    const reading = await usesIn({
      files: {
        'other.ts': 'export const foo = 2;\n',
        [target]: 'export const foo = 1;\n',
        [importer]: `import { foo } from '${specifier}';\n`,
      },
      edges: [`${importer} -> ${target}`],
      names: ['foo'],
      target,
    });
    expect(reading?.uses['foo']?.map(({ path }) => path)).toEqual(
      counts ? [`src/${importer}`] : [],
    );
  },
);

test('a default import uses the default export, wherever it names it', async () => {
  const reading = await usesIn({
    files: {
      'a.ts': 'export default () => 1;\nexport const foo = 2;\n',
      'b.ts': "import Thing, { foo } from './a';\nThing();\n",
      'c.ts': "import * as all from './a';\nall.foo;\n",
    },
    edges: ['b.ts -> a.ts', 'c.ts -> a.ts'],
    names: ['default'],
  });
  expect(reading?.uses).toEqual({
    default: [{ path: 'src/b.ts', line: 2, text: 'Thing();' }],
  });
});
