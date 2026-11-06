import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import type { Graph } from '../../core/graph.ts';
import { writeFiles } from '../../test-support/repos.ts';
import { typeScriptReader } from './reader.ts';
import { NOT_DRAWN } from './typescript-uses.ts';

const idOf = (path: string) => `web/file/${path}`;

const graphOf = (
  files: ReadonlyArray<string>,
  edges: ReadonlyArray<string>,
  elsewhere: ReadonlyArray<string>,
): Graph => ({
  nodes: files.map(path => ({
    id: idOf(path),
    kind: 'file',
    label: path,
    parent: elsewhere.includes(path) ? 'app' : 'web',
    path: `src/${path}`,
  })),
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
  readonly elsewhere?: ReadonlyArray<string>;
  readonly outside?: Readonly<Record<string, string>>;
};

const usesIn = async ({
  files,
  atBase = {},
  edges,
  names,
  target = 'a.ts',
  elsewhere = [],
  outside = {},
}: Scene) => {
  const base = mkdtempSync(join(tmpdir(), 'visual-review-uses-base-'));
  const head = mkdtempSync(join(tmpdir(), 'visual-review-uses-head-'));
  const under = (tree: Readonly<Record<string, string>>) =>
    Object.fromEntries(Object.entries(tree).map(([path, text]) => [`src/${path}`, text]));
  try {
    writeFiles(base, { ...under({ ...files, ...atBase }), 'package.json': '{"name":"@acme/lib"}' });
    writeFiles(head, { ...under(files), ...outside });
    return await typeScriptReader.uses?.({
      base,
      head,
      stacks: new Map([
        ['.', 'web'],
        ['app', 'app'],
      ]),
      graph: graphOf(Object.keys({ ...files, ...atBase }), edges, elsewhere),
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
  { specifier: './types', importer: 'b.ts', target: 'types.d.ts', counts: true },
  { specifier: 'date-fns/a', importer: 'b.ts', target: 'a.ts', counts: false },
  { specifier: '@acme/lib', importer: 'b.ts', target: 'a.ts', counts: false },
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

test.for([
  { specifier: '@acme/lib', counts: true },
  { specifier: '@acme/lib/sub', counts: true },
  { specifier: '@acme/lib-two', counts: false },
])("$specifier in another stack is the package's: $counts", async ({ specifier, counts }) => {
  const reading = await usesIn({
    files: { 'a.ts': 'export const foo = 1;\n', 'b.ts': `import { foo } from '${specifier}';\n` },
    edges: ['b.ts -> a.ts'],
    names: ['foo'],
    elsewhere: ['b.ts'],
  });
  expect(reading?.uses).toEqual({
    foo: counts ? [expect.objectContaining({ path: 'src/b.ts' })] : [],
  });
});

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

test("a default through the package's name may be another file's, so it's marked and goes no further", async () => {
  const reading = await usesIn({
    files: {
      'a.ts': 'export default 1;\n',
      'import.ts': "import Thing from '@acme/lib';\nThing();\n",
      'reexport.ts': "run();\nexport { default as Renamed } from '@acme/lib';\n",
      'alias.ts': "import Other from '@acme/lib';\nexport default Other;\n",
      'beyond.ts':
        "import { Renamed } from './reexport';\nimport Other from './alias';\nRenamed(Other);\n",
    },
    edges: [
      'import.ts -> a.ts',
      'reexport.ts -> a.ts',
      'alias.ts -> a.ts',
      'beyond.ts -> reexport.ts',
      'beyond.ts -> alias.ts',
    ],
    names: ['default'],
    elsewhere: ['import.ts', 'reexport.ts', 'alias.ts', 'beyond.ts'],
  });
  expect(reading?.uses).toEqual({
    default: [
      {
        path: 'src/import.ts',
        line: 1,
        text: "import Thing from '@acme/lib';",
        unfollowed: true,
      },
      {
        path: 'src/reexport.ts',
        line: 2,
        text: "export { default as Renamed } from '@acme/lib';",
        unfollowed: true,
      },
      {
        path: 'src/alias.ts',
        line: 1,
        text: "import Other from '@acme/lib';",
        unfollowed: true,
      },
    ],
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

test('a method is used where a file naming its class first reads the member', async () => {
  const reading = await usesIn({
    files: {
      'a.ts': 'export class Foo {\n  bar() {}\n}\nexport const other = 1;\n',
      'calls.ts':
        "import { Foo } from './a';\nconst foo = new Foo();\nbaz();\nfoo?.bar();\nfoo.bar();\n",
      'member-only.ts': "import { Foo } from './a';\nnew Foo().baz();\n",
      'class-unnamed.ts': "import { other } from './a';\nother.bar();\n",
      'barrel.ts': "export { Foo as Renamed } from './a';\n",
      'through.ts': "import { Renamed } from './barrel';\nRenamed\n  .bar();\n",
      'passes.ts': "import * as a from './a';\nconsole.log(a);\n",
    },
    edges: [
      'calls.ts -> a.ts',
      'member-only.ts -> a.ts',
      'class-unnamed.ts -> a.ts',
      'barrel.ts -> a.ts',
      'through.ts -> barrel.ts',
      'passes.ts -> a.ts',
    ],
    names: ['Foo.bar'],
  });
  expect(reading?.uses).toEqual({
    'Foo.bar': [
      { path: 'src/calls.ts', line: 4, text: 'foo?.bar();' },
      { path: 'src/through.ts', line: 3, text: '.bar();' },
      {
        path: 'src/passes.ts',
        line: 2,
        text: 'console.log(a);',
        unfollowed: true,
      },
    ],
  });
});

test('a constructor is used by what names its class, with no read of `.constructor`', async () => {
  const reading = await usesIn({
    files: {
      'a.ts': 'export class Foo {\n  constructor(one: string) {}\n}\n',
      'makes.ts': "import { Foo } from './a';\nnew Foo('x');\n",
    },
    edges: ['makes.ts -> a.ts'],
    names: ['Foo.constructor'],
  });
  expect(reading?.uses['Foo.constructor']).toEqual([
    { path: 'src/makes.ts', line: 2, text: "new Foo('x');" },
  ]);
});

test.for([
  {
    reason: 'through its default export',
    a: 'export default class Foo {\n  bar() {}\n}\n',
    importer: "import Thing from './a';\nThing.bar();\n",
    row: { line: 2, text: 'Thing.bar();' },
  },
  {
    reason: 'through an export under another name',
    a: 'class Foo {\n  bar() {}\n}\nexport { Foo as Other };\n',
    importer: "import { Other } from './a';\nOther.bar();\n",
    row: { line: 2, text: 'Other.bar();' },
  },
  {
    reason: "marked, through a package's default that may be another file's",
    a: 'export default class Foo {\n  bar() {}\n}\n',
    importer: "import Thing from '@acme/lib';\nThing.bar();\n",
    row: { line: 1, text: "import Thing from '@acme/lib';", unfollowed: true },
  },
])('a method is followed $reason', async ({ a, importer, row }) => {
  const reading = await usesIn({
    files: { 'a.ts': a, 'b.ts': importer },
    edges: ['b.ts -> a.ts'],
    names: ['Foo.bar'],
    elsewhere: ['b.ts'],
  });
  expect(reading?.uses['Foo.bar']).toEqual([{ path: 'src/b.ts', ...row }]);
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

test.for([
  { reason: 'does not parse', broken: "import { foo from './a';\n" },
  { reason: 'is too big', broken: `import { foo } from './a';\n// ${'x'.repeat(1000)}\n` },
])('a file that $reason is not read, and the rest still are', async ({ broken }) => {
  const reading = await usesIn({
    files: {
      'a.ts': 'export const foo = 1;\n',
      'broken.ts': broken,
      'c.ts': "import { foo } from './a';\nfoo();\n",
    },
    edges: ['broken.ts -> a.ts', 'c.ts -> a.ts'],
    names: ['foo'],
  });
  expect(reading).toEqual({
    uses: { foo: [{ path: 'src/c.ts', line: 2, text: 'foo();' }] },
    notRead: ['src/broken.ts'],
    notFollowed: [NOT_DRAWN],
  });
});

test('a file reached twice is named not read once', async () => {
  const reading = await usesIn({
    files: {
      'a.ts': 'export const foo = 1;\n',
      'one.ts': "export * from './a';\n",
      'two.ts': "export * from './a';\n",
      'broken.ts': 'import {',
    },
    edges: ['one.ts -> a.ts', 'two.ts -> a.ts', 'broken.ts -> one.ts', 'broken.ts -> two.ts'],
    names: ['foo'],
  });
  expect(reading?.notRead).toEqual(['src/broken.ts']);
});

test('a file gone at the head has no uses and is not named', async () => {
  const reading = await usesIn({
    files: { 'a.ts': 'export const foo = 1;\n' },
    atBase: { 'b.ts': "import { foo } from './a';\nfoo();\n" },
    edges: ['b.ts -> a.ts'],
    names: ['foo'],
  });
  expect(reading).toEqual({ uses: { foo: [] }, notRead: [], notFollowed: [NOT_DRAWN] });
});

test('a file outside the source root, with no node, uses a name as a drawn one does', async () => {
  const reading = await usesIn({
    files: { 'a.ts': 'export const foo = 1;\n' },
    outside: {
      'package.json': '{"name":"web"}',
      'test/a.test.ts': "import { foo } from '../src/a';\nfoo();\n",
    },
    edges: [],
    names: ['foo'],
  });

  expect(reading?.uses).toEqual({
    foo: [{ path: 'test/a.test.ts', line: 2, text: 'foo();' }],
  });
});

test('a file outside the source root importing its own package by name uses it', async () => {
  const reading = await usesIn({
    files: { 'a.ts': 'export const foo = 1;\n' },
    outside: {
      'package.json': '{"name":"@acme/lib"}',
      'test/a.test.ts': "import { foo } from '@acme/lib';\nfoo();\n",
    },
    edges: [],
    names: ['foo'],
  });

  expect(reading?.uses).toEqual({
    foo: [{ path: 'test/a.test.ts', line: 2, text: 'foo();' }],
  });
});

test('an outside barrel is followed to the files importing it, by the name it gives', async () => {
  const reading = await usesIn({
    files: { 'a.ts': 'export const foo = 1;\n' },
    outside: {
      'test/helpers/index.ts': "export { foo as bar } from '../../src/a';\n",
      'test/b.test.ts': "import { bar } from './helpers';\nbar();\n",
    },
    edges: [],
    names: ['foo'],
  });

  expect(reading?.uses).toEqual({
    foo: [
      expect.objectContaining({ path: 'test/helpers/index.ts' }),
      expect.objectContaining({ path: 'test/b.test.ts' }),
    ],
  });
});

test('an outside barrel is followed to a drawn file importing it', async () => {
  const reading = await usesIn({
    files: {
      'a.ts': 'export const foo = 1;\n',
      'b.ts': "import { foo } from '../test/helpers';\nfoo();\n",
    },
    outside: { 'test/helpers/index.ts': "export { foo } from '../../src/a';\n" },
    edges: [],
    names: ['foo'],
  });

  expect(reading?.uses).toEqual({
    foo: [
      expect.objectContaining({ path: 'test/helpers/index.ts' }),
      { path: 'src/b.ts', line: 2, text: 'foo();' },
    ],
  });
});

test('a drawn file with no edge to a drawn target is not read', async () => {
  const reading = await usesIn({
    files: { 'a.ts': 'export const foo = 1;\n', 'broken.ts': 'const = ;\n' },
    edges: [],
    names: ['foo'],
  });

  expect(reading?.notRead).toEqual([]);
});

test("an outside barrel's importers are scripts: a drawn stylesheet or Ruby class isn't read as one", async () => {
  const reading = await usesIn({
    files: {
      'a.ts': 'export const foo = 1;\n',
      'logo.scss': '.logo { color: red; }\n',
      'b.rb': 'class B; end\n',
    },
    outside: { 'test/helpers/index.ts': "export { foo } from '../../src/a';\n" },
    edges: [],
    names: ['foo'],
  });

  expect(reading?.notRead).toEqual([]);
});

test.for([
  { place: 'a nested package', path: 'packages/x/y.ts', own: 'packages/x/package.json' },
  { place: 'node_modules', path: 'node_modules/x/y.ts', own: 'node_modules/x/z.txt' },
])("a file in $place isn't this stack's, so it isn't read", async ({ path, own }) => {
  const reading = await usesIn({
    files: { 'a.ts': 'export const foo = 1;\n' },
    outside: { [own]: '{}', [path]: "import { foo } from '/src/a';\nimport * from ;\n" },
    edges: [],
    names: ['foo'],
  });

  expect(reading).toMatchObject({ uses: { foo: [] }, notRead: [] });
});

test.for([
  { alias: './lib/*', rootAlias: './src/*', paths: [] },
  { alias: '../src/*', rootAlias: './lib/*', paths: ['app/z.ts'] },
])(
  "a file in another stack's root is read with that stack's aliases: $alias",
  async ({ alias, rootAlias, paths }) => {
    const reading = await usesIn({
      files: { 'a.ts': 'export const foo = 1;\n' },
      outside: {
        'tsconfig.json': `{"compilerOptions":{"paths":{"@/*":["${rootAlias}"]}}}`,
        'app/tsconfig.json': `{"compilerOptions":{"paths":{"@/*":["${alias}"]}}}`,
        'app/z.ts': "import { foo } from '@/a';\nfoo();\n",
      },
      edges: [],
      names: ['foo'],
    });

    expect(reading?.uses).toEqual({
      foo: paths.map(path => expect.objectContaining({ path })),
    });
  },
);

const scriptsOutside = (count: number): Readonly<Record<string, string>> =>
  Object.fromEntries(
    Array.from({ length: count }, (_, index) => [
      `test/${index}.ts`,
      index === 0 ? "import { foo } from '../src/a';\n" : '',
    ]),
  );

test.for([
  {
    outsideFiles: 5000,
    paths: ['test/0.ts', 'app/z.ts'],
    notFollowed: [NOT_DRAWN],
  },
  {
    outsideFiles: 5001,
    paths: ['app/z.ts'],
    notFollowed: ['not followed: web has over 5000 files outside its source root', NOT_DRAWN],
  },
])(
  'a stack with $outsideFiles files holding no node reads $paths, the drawn file and the other stack not counting',
  async ({ outsideFiles, paths, notFollowed }) => {
    const reading = await usesIn({
      files: { 'a.ts': 'export const foo = 1;\n' },
      outside: {
        ...scriptsOutside(outsideFiles),
        'app/package.json': '{"name":"app"}',
        'app/z.ts': "import { foo } from '../src/a';\n",
      },
      edges: [],
      names: ['foo'],
    });

    expect(reading?.uses).toEqual({ foo: paths.map(path => expect.objectContaining({ path })) });
    expect(reading?.notFollowed).toEqual(notFollowed);
  },
);
