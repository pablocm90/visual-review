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
  readonly atBase?: Readonly<Record<string, string>>;
  readonly edges: ReadonlyArray<string>;
  readonly names: ReadonlyArray<string>;
  readonly target?: string;
};

const usesIn = async ({ files, atBase = {}, edges, names, target = 'a.ts' }: Scene) => {
  const base = mkdtempSync(join(tmpdir(), 'visual-review-uses-base-'));
  const head = mkdtempSync(join(tmpdir(), 'visual-review-uses-head-'));
  const under = (tree: Readonly<Record<string, string>>) =>
    Object.fromEntries(Object.entries(tree).map(([path, text]) => [`src/${path}`, text]));
  try {
    writeFiles(base, under({ ...files, ...atBase }));
    writeFiles(head, under(files));
    return await typeScriptReader.uses?.({
      base,
      head,
      graph: graphOf(Object.keys({ ...files, ...atBase }), edges),
      node: { id: idOf(target), path: `src/${target}` },
      names,
    });
  } finally {
    rmSync(base, { recursive: true, force: true });
    rmSync(head, { recursive: true, force: true });
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
        [target]: 'export const foo = 1;\n',
        [importer]: `import { foo } from '${specifier}';\n`,
      },
      edges: [`${importer} -> ${target}`],
      names: ['foo'],
      target,
    });
    expect(reading?.uses).toEqual({
      foo: counts ? [expect.objectContaining({ path: `src/${importer}` })] : [],
    });
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

test.for([
  {
    reason: 'a named default function is imported as default',
    base: 'export default function App() {}\n',
    asked: 'App',
    importer: "import Thing from './a';\nThing();\n",
    line: 2,
  },
  {
    reason: 'a default export of a local is imported as default',
    base: 'const App = 1;\nexport default App;\n',
    asked: 'App',
    importer: "import Thing from './a';\nThing;\n",
    line: 2,
  },
  {
    reason: 'an export under another name is imported by that name',
    base: 'const a = 1;\nexport { a as b };\n',
    asked: 'a',
    importer: "import { b } from './a';\nb;\n",
    line: 2,
  },
  {
    reason: 'a name exported directly and under another is imported by either',
    base: 'export const a = 1;\nexport { a as b };\n',
    asked: 'a',
    importer: "import { a } from './a';\na;\n",
    line: 2,
  },
  {
    reason: 'a name no local backs is imported by itself',
    base: "export { c } from './d';\n",
    asked: 'c',
    importer: "import { c } from './a';\nc;\n",
    line: 2,
  },
  {
    reason: 'a file importing it under two names is one use, at the first',
    base: 'export function App() {}\nexport default App;\n',
    asked: 'App',
    importer: "import Thing, { App } from './a';\nApp();\nThing();\n",
    line: 2,
  },
  {
    reason: 'a use by a name it was exported under beats a namespace passed along',
    base: 'export default function App() {}\n',
    asked: 'App',
    importer: "import * as all from './a';\nimport Thing from './a';\npass(all);\nThing();\n",
    line: 4,
  },
])('$reason', async ({ base, asked, importer, line }) => {
  const reading = await usesIn({
    files: { 'b.ts': importer },
    atBase: { 'a.ts': base },
    edges: ['b.ts -> a.ts'],
    names: [asked],
  });
  expect(reading?.uses[asked]?.map(use => use.line)).toEqual([line]);
});

test.for([
  {
    reason: 're-exported from elsewhere under that name',
    base: "export const a = 1;\nexport { a as b } from './d';\n",
  },
  {
    reason: "another local's export name",
    base: 'export const a = 1;\nconst other = 2;\nexport { other as b };\n',
  },
])('an import of $reason is no use of the asked name', async ({ base }) => {
  const reading = await usesIn({
    files: { 'b.ts': "import { b } from './a';\nb;\n" },
    atBase: { 'a.ts': base },
    edges: ['b.ts -> a.ts'],
    names: ['a'],
  });
  expect(reading?.uses).toEqual({ a: [] });
});

test('a namespace import uses a name where it first reads it off the namespace', async () => {
  const reading = await usesIn({
    files: {
      'a.ts': 'export const foo = 1;\nexport const bar = 2;\nexport const baz = 3;\n',
      'b.ts': "import * as all from './a';\nother.all;\nall.foo(1);\nall.foo(2);\nall?.bar;\n",
    },
    edges: ['b.ts -> a.ts'],
    names: ['foo', 'bar', 'baz'],
  });
  expect(reading?.uses).toEqual({
    foo: [{ path: 'src/b.ts', line: 3, text: 'all.foo(1);' }],
    bar: [{ path: 'src/b.ts', line: 5, text: 'all?.bar;' }],
    baz: [],
  });
});

test.for([
  { reason: 'passes it along', statement: 'pass(all);' },
  { reason: 'indexes it', statement: 'all[key];' },
])('a file that $reason may use any name, not followed', async ({ statement }) => {
  const reading = await usesIn({
    files: {
      'a.ts': 'export const foo = 1;\nexport const bar = 2;\n',
      'b.ts': `import * as all from './a';\nall.foo;\n${statement}\n`,
    },
    edges: ['b.ts -> a.ts'],
    names: ['foo', 'bar'],
  });
  expect(reading?.uses).toEqual({
    foo: [{ path: 'src/b.ts', line: 2, text: 'all.foo;' }],
    bar: [{ path: 'src/b.ts', line: 3, text: statement, unfollowed: true }],
  });
});

test.for([
  { statement: "import('./a').then(run);" },
  { statement: 'import(`./a`);' },
  { statement: "const a = require('./a');" },
  { statement: "export * as all from './a';" },
])('$statement may use any name, not followed', async ({ statement }) => {
  const reading = await usesIn({
    files: { 'a.ts': 'export const foo = 1;\n', 'b.ts': `run();\n${statement}\n` },
    edges: ['b.ts -> a.ts'],
    names: ['foo'],
  });
  expect(reading?.uses).toEqual({
    foo: [{ path: 'src/b.ts', line: 2, text: statement, unfollowed: true }],
  });
});

test.for([
  { statement: "import('./other');" },
  { statement: "require('./other');" },
  { statement: "export * as all from './other';" },
  { statement: "export { bar } from './a';" },
  { statement: "export { foo } from './other';" },
  { statement: "thing.require('./a');" },
  { statement: "require.resolve('./a');" },
  { statement: 'import.meta.url;' },
])('$statement says nothing of the file', async ({ statement }) => {
  const reading = await usesIn({
    files: { 'a.ts': 'export const foo = 1;\n', 'b.ts': `${statement}\n` },
    edges: ['b.ts -> a.ts'],
    names: ['foo'],
  });
  expect(reading?.uses).toEqual({ foo: [] });
});

test('a named re-export is a use at its statement, and its importers use the name it gives', async () => {
  const reading = await usesIn({
    files: {
      'a.ts': 'export const foo = 1;\n',
      'index.ts':
        "run();\nexport { foo as baz } from './a';\nexport { bar as other } from './a';\n",
      'g.ts': "import { other } from './index';\nother();\n",
      'outer.ts': "export { baz as qux } from './index';\n",
      'd.ts': "import { baz } from './index';\nbaz();\n",
      'e.ts': "import { foo } from './index';\nfoo();\n",
      'f.ts': "import { qux } from './outer';\nqux();\n",
    },
    edges: [
      'index.ts -> a.ts',
      'outer.ts -> index.ts',
      'd.ts -> index.ts',
      'e.ts -> index.ts',
      'g.ts -> index.ts',
      'f.ts -> outer.ts',
    ],
    names: ['foo'],
  });
  expect(reading?.uses).toEqual({
    foo: [
      { path: 'src/index.ts', line: 2, text: "export { foo as baz } from './a';" },
      { path: 'src/outer.ts', line: 1, text: "export { baz as qux } from './index';" },
      { path: 'src/d.ts', line: 2, text: 'baz();' },
      { path: 'src/f.ts', line: 2, text: 'qux();' },
    ],
  });
});

test('a star re-export has no row and passes on every name but the default', async () => {
  const reading = await usesIn({
    files: {
      'a.ts': 'export default 1;\nexport const foo = 2;\n',
      'index.ts': "export * from './a';\n",
      'elsewhere.ts': "export * from './other';\n",
      'd.ts': "import Thing, { foo } from './index';\nfoo();\nThing();\n",
      'e.ts': "import { foo } from './elsewhere';\nfoo();\n",
    },
    edges: ['index.ts -> a.ts', 'elsewhere.ts -> a.ts', 'd.ts -> index.ts', 'e.ts -> elsewhere.ts'],
    names: ['foo', 'default'],
  });
  expect(reading?.uses).toEqual({
    foo: [{ path: 'src/d.ts', line: 2, text: 'foo();' }],
    default: [],
  });
});

test('a barrel cycle ends, and a file reached twice has one row per asked name', async () => {
  const reading = await usesIn({
    files: {
      'a.ts': 'export const foo = 1;\nexport const bar = 2;\n',
      'one.ts': "export * from './a';\nexport * from './two';\n",
      'two.ts': "export * from './one';\n",
      'd.ts':
        "import { foo, bar } from './one';\nimport { foo as again } from './two';\nfoo();\nbar();\n",
    },
    edges: [
      'one.ts -> a.ts',
      'one.ts -> two.ts',
      'two.ts -> one.ts',
      'd.ts -> one.ts',
      'd.ts -> two.ts',
    ],
    names: ['foo', 'bar'],
  });
  expect(reading?.uses).toEqual({
    foo: [{ path: 'src/d.ts', line: 3, text: 'foo();' }],
    bar: [{ path: 'src/d.ts', line: 4, text: 'bar();' }],
  });
});

test.for([
  {
    reason: 'exported under another name',
    barrel: "import { foo as local } from './a';\nexport { local as baz };\n",
    importer: "import { baz } from './index';\nbaz();\n",
  },
  {
    reason: 'exported as the default',
    barrel: "import { foo as local } from './a';\nexport default local;\n",
    importer: "import Thing from './index';\nThing();\n",
  },
])('an import $reason passes the name on to its importers', async ({ barrel, importer }) => {
  const reading = await usesIn({
    files: {
      'a.ts': 'export const foo = 1;\n',
      'index.ts': `${barrel}const other = 2;\nexport { other };\n`,
      'd.ts': importer,
      'e.ts': "import { other } from './index';\nother();\n",
    },
    edges: ['index.ts -> a.ts', 'd.ts -> index.ts', 'e.ts -> index.ts'],
    names: ['foo'],
  });
  expect(reading?.uses).toEqual({
    foo: [
      expect.objectContaining({ path: 'src/index.ts', line: 2 }),
      { path: 'src/d.ts', line: 2, text: importer.split('\n')[1] },
    ],
  });
});
