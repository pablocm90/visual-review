// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { reviewedHead } from '../test-support/reviewed.ts';
import type { Graph, GraphNode } from './graph.ts';
import type { LogicLine } from './logic-diff.ts';
import { metricFindings } from './metric-findings.ts';
import type { ReviewNotes } from './notes.ts';
import { notedPageHtml, pageData, pageHtml, pageIn, servedPageHtml } from './page.ts';
import type {
  RangeReading,
  ReviewedDiff,
  ReviewedHead,
  ReviewedReading,
  SymbolFile,
} from './read-range.ts';
import type { Review } from './review.ts';
import type { SymbolStatement } from './symbol-changes.ts';
import type { TestFile } from './test-changes.ts';

const webFile = (path: string): GraphNode => ({
  id: `web/file/${path}`,
  kind: 'file',
  label: path,
  parent: 'web',
  path: `web/src/${path}`,
});

const box = (name: string): GraphNode => ({
  id: `web/box/${name}`,
  kind: 'module',
  label: name,
  parent: 'web',
  path: `web/src/${name}`,
});
const inBox = (name: string, file: string): GraphNode => ({
  ...webFile(`${name}/${file}`),
  parent: `web/box/${name}`,
});

const webStack: GraphNode = { id: 'web', kind: 'stack', label: 'web', path: '' };

const patch = (path: string) => ({ path, patch: `diff --git a/${path} b/${path}` });

const readingWith = (overrides: Partial<RangeReading>): RangeReading => ({
  before: { nodes: [webStack], edges: [] },
  after: { nodes: [webStack, webFile('a.ts')], edges: [] },
  churn: { before: {}, after: {} },
  measures: { before: {}, after: {} },
  changedPaths: ['web/src/a.ts'],
  renames: [],
  patches: [],
  dependencyChanges: [],
  migrations: [],
  schemas: [],
  tests: [],
  symbols: [],
  symbolsNotRead: [],
  danglingCalls: [],
  skipped: [],
  thresholds: { cyclomatic: 10, splitParts: 4, hotspot: { churn: 6, cyclomatic: 8 } },
  churnDays: 90,
  ...overrides,
});

test("a reading's page data holds its diff, the reading order of its changed parts, its dangling calls, dependency changes, test files and symbol changes, the patches of drawn files apart from the rest, its metric thresholds and churn window, and an empty list of skipped stacks", () => {
  const tests = [{ path: 'web/a.test.ts', stack: 'web', unreadable: 'SyntaxError' }];
  const symbols = [{ node: 'web/file/a.ts', stack: 'web', unreadable: 'SyntaxError' }];
  const dependencyChanges = [{ lockfile: 'yarn.lock', notRead: 'Yarn 2+ format' }];
  const thresholds = {
    cyclomatic: 12,
    splitParts: 4,
    hotspot: { churn: 5, cyclomatic: 9 },
    lines: 300,
  };
  const reading = readingWith({
    thresholds,
    churnDays: 30,
    patches: [patch('web/src/a.ts'), patch('README.md')],
    danglingCalls: [{ from: 'web/file/a.ts', path: '/api/x' }],
    dependencyChanges,
    tests,
    symbols,
  });

  expect(
    pageData({ repo: 'shop', reading, range: 'main..feature', version: '1.2.3', parsers }),
  ).toStrictEqual({
    repo: 'shop',
    range: 'main..feature',
    version: '1.2.3',
    parsers: { '@babel/parser': '8.0.7' },
    diff: {
      nodes: [
        { ...webStack, state: 'unchanged' },
        { ...webFile('a.ts'), state: 'added' },
      ],
      edges: [],
    },
    readingOrder: { parts: ['web/file/a.ts'], cycles: [] },
    metrics: {},
    findings: expect.any(Array),
    dangling: [{ from: 'web/file/a.ts', path: '/api/x' }],
    patches: [patch('web/src/a.ts')],
    undrawn: [patch('README.md')],
    dependencyChanges,
    migrations: [],
    schemas: [],
    tests,
    symbols,
    skipped: [],
    thresholds: { cyclomatic: 12, splitParts: 4, hotspot: { churn: 5, cyclomatic: 9 }, lines: 300 },
    churnDays: 30,
  });
});

test("a pull request's page data names it, and lists the stacks a missing tool kept from being read", () => {
  const pullRequest = { number: 7, title: 'Adds a', url: 'https://github.com/acme/shop/pull/7' };
  const skipped = [{ reader: 'rust' as const, tool: 'cargo', stacks: ['rust'] }];

  expect(
    pageData({
      repo: 'shop',
      reading: readingWith({ skipped }),
      range: 'abc..def',
      version,
      parsers,
      pullRequest,
    }),
  ).toMatchObject({ range: 'abc..def', pullRequest, skipped });
});

const version = '1.2.3';

const parsers = { '@babel/parser': '8.0.7' };

test.for([
  { paths: ['README.md'], title: '1 changed file outside the graph' },
  { paths: ['README.md', 'docs/x.md'], title: '2 changed files outside the graph' },
])(
  'changed files outside the graph are one structure finding for information, listing them: $title',
  ({ paths, title }) => {
    const reading = readingWith({ patches: [patch('web/src/a.ts'), ...paths.map(patch)] });

    expect(
      pageData({ repo: 'shop', reading, range: 'a..b', version, parsers }).findings,
    ).toStrictEqual([
      {
        id: 'structure:undrawn',
        dimension: 'structure',
        level: 'info',
        title,
        detail: paths.join(', '),
      },
    ]);
  },
);

test.for([
  {
    paths: ['src/bad\uFFFD.ts'],
    title: "1 changed file's name isn't UTF-8, so its patch can't be shown",
  },
  {
    paths: ['src/bad\uFFFD.ts', 'caf\uFFFD.txt'],
    title: "2 changed files' names aren't UTF-8, so their patches can't be shown",
  },
])(
  'a changed file whose name git gave undecodably needs a look, listing only such files: $title',
  ({ paths, title }) => {
    const reading = readingWith({ changedPaths: ['README.md', ...paths] });

    expect(
      pageData({ repo: 'shop', reading, range: 'a..b', version, parsers }).findings,
    ).toContainEqual({
      id: 'structure:name-not-utf8',
      dimension: 'structure',
      level: 'look',
      title,
      detail: paths.join(', '),
    });
  },
);

test('fetch calls with no route are a routes finding for information on each calling file, listing its paths', () => {
  const danglingCalls = [
    { from: 'web/file/a.ts', path: '/api/a' },
    { from: 'web/file/b.ts', path: '/api/c' },
    { from: 'web/file/a.ts', path: '/api/b' },
  ];

  expect(
    pageData({
      repo: 'shop',
      reading: readingWith({ danglingCalls }),
      range: 'a..b',
      version,
      parsers,
    }).findings,
  ).toStrictEqual([
    {
      id: 'routes:dangling:web/file/a.ts',
      dimension: 'routes',
      level: 'info',
      target: 'web/file/a.ts',
      title: '2 calls with no route',
      detail: '/api/a, /api/b',
    },
    {
      id: 'routes:dangling:web/file/b.ts',
      dimension: 'routes',
      level: 'info',
      target: 'web/file/b.ts',
      title: '1 call with no route',
      detail: '/api/c',
    },
  ]);
});

test("a lockfile's changes raise their findings on the page", () => {
  const dependencyChanges = [
    {
      lockfile: 'pnpm-lock.yaml',
      ecosystem: 'npm',
      packages: [
        { name: 'zod', change: 'major' as const, direct: true, from: ['3.0.0'], to: ['4.0.0'] },
      ],
    },
  ];

  expect(
    pageData({
      repo: 'shop',
      reading: readingWith({ dependencyChanges }),
      range: 'a..b',
      version,
      parsers,
    }).findings.map(({ id }) => id),
  ).toContain('dependencies:pnpm-lock.yaml:zod');
});

test("an added migration's risks raise their findings on the page, and it keeps the reading", () => {
  const migrations = [{ file: 'db/migrate/1_a.rb', notRead: 'Ruby syntax error' }];

  const data = pageData({
    repo: 'shop',
    reading: readingWith({ migrations }),
    range: 'a..b',
    version,
    parsers,
  });

  expect(data.migrations).toStrictEqual(migrations);
  expect(data.findings.map(({ id }) => id)).toContain('schema:not-read:db/migrate/1_a.rb');
});

test("a changed schema's reading stays on the page and raises its findings", () => {
  const schemas = [{ file: 'db/schema.rb', notRead: 'Ruby syntax error' }];

  const data = pageData({
    repo: 'shop',
    reading: readingWith({ schemas }),
    range: 'a..b',
    version,
    parsers,
  });

  expect(data.schemas).toStrictEqual(schemas);
  expect(data.findings.map(({ id }) => id)).toContain('schema:not-read:db/schema.rb');
});

test('stacks a missing tool kept from being read are a structure finding to look at, on no node', () => {
  const skipped = [{ reader: 'rust' as const, tool: 'cargo', stacks: ['api', 'worker'] }];

  expect(
    pageData({ repo: 'shop', reading: readingWith({ skipped }), range: 'a..b', version, parsers })
      .findings,
  ).toStrictEqual([
    {
      id: 'structure:skipped:rust',
      dimension: 'structure',
      level: 'look',
      title: 'api, worker not read: cargo not found on PATH',
    },
  ]);
});

test('each stack with changed files whose reader reads no symbols is a structure finding for information on that stack', () => {
  const reading = readingWith({ symbolsNotRead: ['api', 'admin'] });

  expect(
    pageData({ repo: 'shop', reading, range: 'a..b', version, parsers }).findings,
  ).toStrictEqual([
    {
      id: 'structure:symbols-not-read:api',
      dimension: 'structure',
      level: 'info',
      target: 'api',
      title: 'symbols not read for api',
    },
    {
      id: 'structure:symbols-not-read:admin',
      dimension: 'structure',
      level: 'info',
      target: 'admin',
      title: 'symbols not read for admin',
    },
  ]);
});

const symbolFile = (symbols: ReadonlyArray<SymbolStatement>): SymbolFile => ({
  node: 'web/file/a.ts',
  stack: 'web',
  symbols,
  exports: { added: [], removed: [] },
  kind: 'api',
});

const findingsOfSymbols = (
  symbols: ReadonlyArray<SymbolFile>,
  tests: ReadonlyArray<TestFile> = [],
) =>
  pageData({
    repo: 'shop',
    reading: readingWith({
      symbols,
      tests,
      before: { nodes: [webStack, webFile('a.ts'), webFile('c.ts')], edges: [] },
      after: { nodes: [webStack, webFile('a.ts'), webFile('b.ts'), webFile('d.ts')], edges: [] },
    }),
    range: 'a..b',
    version,
    parsers,
  }).findings;

test('an exported symbol removed, or no longer exported, is an api finding to look at on its file, named by its kind and qualified name', () => {
  const symbols = [
    symbolFile([
      { name: 'charge', kind: 'function', exported: { base: true }, change: 'removed' },
      {
        name: 'refund',
        scope: 'Orders',
        kind: 'method',
        exported: { base: true, head: false },
        change: 'edited',
      },
      { name: 'helper', kind: 'function', exported: { base: false }, change: 'removed' },
      { name: 'fresh', kind: 'function', exported: { head: false }, change: 'added' },
      { name: 'total', kind: 'function', exported: { base: true, head: true }, change: 'edited' },
    ]),
  ];

  expect(findingsOfSymbols(symbols)).toStrictEqual([
    {
      id: 'api:removed:web/file/a.ts#charge',
      dimension: 'api',
      level: 'look',
      target: 'web/file/a.ts',
      title: 'function charge removed',
    },
    {
      id: 'api:removed:web/file/a.ts#Orders.refund',
      dimension: 'api',
      level: 'look',
      target: 'web/file/a.ts',
      title: 'method Orders.refund no longer exported',
    },
  ]);
});

test('an exported symbol renamed or moved away is a removal, the title naming its former name and where it went, a file by its path, a probable rename saying how it was found', () => {
  const symbols = [
    symbolFile([
      {
        name: 'bill',
        scope: 'Orders',
        kind: 'method',
        exported: { base: true, head: true },
        change: 'renamed',
        renamedFrom: 'Orders.charge',
      },
      {
        name: 'pay',
        kind: 'function',
        exported: { base: true, head: false },
        change: 'renamed',
        renamedFrom: 'settle',
        probably: true,
      },
      {
        name: 'total',
        kind: 'function',
        exported: { base: true },
        change: 'moved',
        movedTo: 'web/file/b.ts',
      },
    ]),
  ];

  expect(findingsOfSymbols(symbols)).toStrictEqual([
    {
      id: 'api:removed:web/file/a.ts#Orders.bill',
      dimension: 'api',
      level: 'look',
      target: 'web/file/a.ts',
      title: 'method Orders.charge renamed to Orders.bill',
    },
    {
      id: 'api:removed:web/file/a.ts#pay',
      dimension: 'api',
      level: 'look',
      target: 'web/file/a.ts',
      title: 'function settle probably renamed to pay',
      detail: 'found by body similarity',
    },
    {
      id: 'api:removed:web/file/a.ts#total',
      dimension: 'api',
      level: 'look',
      target: 'web/file/a.ts',
      title: 'function total moved to web/src/b.ts',
    },
  ]);
});

test.for([
  {
    how: 'removed',
    change: { exported: { base: true }, change: 'removed' },
    prefix: 'api:removed',
  },
  {
    how: 'renamed from one name',
    change: { exported: { base: true, head: true }, change: 'renamed', renamedFrom: 'C.old' },
    prefix: 'api:removed',
  },
  {
    how: 'added',
    change: { exported: { head: true }, change: 'added' },
    prefix: 'api:added',
  },
  {
    how: 'changing their signature',
    change: {
      exported: { base: true, head: true },
      change: 'edited',
      signature: { base: '()', head: '(): number' },
    },
    prefix: 'api:signature',
  },
] satisfies ReadonlyArray<{
  how: string;
  change: Pick<SymbolStatement, 'exported' | 'change' | 'renamedFrom' | 'signature'>;
  prefix: string;
}>)(
  'two exported accessors of one name $how are two findings, the later id counting the symbol',
  ({ change, prefix }) => {
    const accessor = (kind: 'getter' | 'setter'): SymbolStatement => ({
      name: 'x',
      scope: 'C',
      kind,
      ...change,
    });

    expect(
      findingsOfSymbols([symbolFile([accessor('getter'), accessor('setter')])]).map(({ id }) => id),
    ).toStrictEqual([`${prefix}:web/file/a.ts#C.x`, `${prefix}:web/file/a.ts#C.x#2`]);
  },
);

test('an exported symbol whose signature changed is an api finding to look at, its detail summing up what moved; one changed on a symbol not exported raises none', () => {
  const signature = { base: '(order: Order)', head: '(order: Order, at: Date)' };
  const symbols = [
    symbolFile([
      {
        name: 'charge',
        scope: 'Orders',
        kind: 'method',
        exported: { base: true, head: true },
        change: 'edited',
        signature,
      },
      {
        name: 'quiet',
        kind: 'function',
        exported: { base: false, head: false },
        change: 'edited',
        signature,
      },
      { name: 'total', kind: 'function', exported: { base: true, head: true }, change: 'edited' },
    ]),
  ];

  expect(findingsOfSymbols(symbols)).toStrictEqual([
    {
      id: 'api:signature:web/file/a.ts#Orders.charge',
      dimension: 'api',
      level: 'look',
      target: 'web/file/a.ts',
      title: "method Orders.charge's signature changed",
      detail: '1 member added',
    },
  ]);
});

test('an export added, moved in or newly exported is an api finding for information', () => {
  const symbols = [
    symbolFile([
      { name: 'charge', kind: 'function', exported: { head: true }, change: 'added' },
      {
        name: 'tax',
        kind: 'function',
        exported: { head: true },
        change: 'moved',
        movedFrom: 'web/file/c.ts',
      },
      {
        name: 'Order',
        kind: 'type',
        exported: { base: false, head: true },
        change: 'unchanged',
      },
      { name: 'helper', kind: 'function', exported: { head: false }, change: 'added' },
    ]),
  ];

  expect(findingsOfSymbols(symbols)).toStrictEqual([
    {
      id: 'api:added:web/file/a.ts#charge',
      dimension: 'api',
      level: 'info',
      target: 'web/file/a.ts',
      title: 'function charge added',
    },
    {
      id: 'api:added:web/file/a.ts#tax',
      dimension: 'api',
      level: 'info',
      target: 'web/file/a.ts',
      title: 'function tax moved from web/src/c.ts',
    },
    {
      id: 'api:added:web/file/a.ts#Order',
      dimension: 'api',
      level: 'info',
      target: 'web/file/a.ts',
      title: 'type Order now exported',
    },
  ]);
});

const exportListFindings = (symbols: ReadonlyArray<SymbolFile>) =>
  findingsOfSymbols(symbols).filter(({ id }) => id.startsWith('api:exports:'));

test.for([
  {
    exports: { added: ['* from ./x'], removed: ['LIMIT', 'charge', 'settle'] },
    level: 'look',
    detail: 'removed LIMIT; added * from ./x',
  },
  { exports: { added: ['LIMIT', 'bill'], removed: [] }, level: 'info', detail: 'added LIMIT' },
])(
  'export names changed with no symbol of the file behind them are one api finding on the file, to look at when one was removed: $detail',
  ({ exports, level, detail }) => {
    const symbols = [
      {
        ...symbolFile([
          { name: 'charge', kind: 'function', exported: { base: true }, change: 'removed' },
          {
            name: 'bill',
            kind: 'function',
            exported: { base: true, head: true },
            change: 'renamed',
            renamedFrom: 'settle',
          },
        ]),
        exports,
      },
    ];

    expect(exportListFindings(symbols)).toStrictEqual([
      {
        id: 'api:exports:web/file/a.ts',
        dimension: 'api',
        level,
        target: 'web/file/a.ts',
        title: 'export list changed',
        detail,
      },
    ]);
  },
);

test('an export name is behind a symbol only when that symbol raises an api finding of its own under it: not an unchanged local of the same name, nor a method', () => {
  const symbols = [
    {
      ...symbolFile([
        {
          name: 'format',
          kind: 'function',
          exported: { base: false, head: false },
          change: 'unchanged',
        },
        {
          name: 'total',
          scope: 'Receipt',
          kind: 'method',
          exported: { base: true },
          change: 'removed',
        },
      ]),
      exports: { added: [], removed: ['format', 'total'] },
    },
  ];

  expect(exportListFindings(symbols).map(({ detail }) => detail)).toStrictEqual([
    'removed format, total',
  ]);
});

test('a file whose export names changed only by its symbols raises no export list finding', () => {
  const symbols = [
    {
      ...symbolFile([
        { name: 'charge', kind: 'function', exported: { head: true }, change: 'added' },
      ]),
      exports: { added: ['charge'], removed: [] },
    },
  ];

  expect(exportListFindings(symbols)).toStrictEqual([]);
});

test("a changed file whose symbols wouldn't parse is a structure finding for information on it, its detail the parse error", () => {
  const symbols = [{ node: 'web/file/a.ts', stack: 'web', unreadable: 'Unexpected token (3:4)' }];

  expect(findingsOfSymbols(symbols)).toStrictEqual([
    {
      id: 'structure:unreadable-symbols:web/file/a.ts',
      dimension: 'structure',
      level: 'info',
      target: 'web/file/a.ts',
      title: 'symbols not read',
      detail: 'Unexpected token (3:4)',
    },
  ]);
});

test("a class's methods raise no api finding of their own when the class itself was removed, renamed or added; under a class kept, a method's change is its own", () => {
  const method = (
    scope: string,
    exported: SymbolStatement['exported'],
    change: SymbolStatement['change'],
  ): SymbolStatement => ({ name: 'charge', scope, kind: 'method', exported, change });
  const symbols = [
    symbolFile([
      { name: 'Orders', kind: 'class', exported: { base: true }, change: 'removed' },
      method('Orders', { base: true }, 'removed'),
      {
        name: 'Billing',
        kind: 'class',
        exported: { base: true, head: true },
        change: 'renamed',
        renamedFrom: 'Bills',
      },
      { ...method('Billing', { base: true, head: true }, 'renamed'), renamedFrom: 'Bills.charge' },
      { name: 'Cart', kind: 'class', exported: { head: true }, change: 'added' },
      method('Cart', { head: true }, 'added'),
      { name: 'Till', kind: 'class', exported: { base: true, head: true }, change: 'edited' },
      method('Till', { base: true }, 'removed'),
    ]),
  ];

  expect(findingsOfSymbols(symbols).map(finding => finding.title)).toStrictEqual([
    'class Orders removed',
    'class Bills renamed to Billing',
    'class Cart added',
    'method Till.charge removed',
  ]);
});

const logicLine = (line: Partial<LogicLine> & Pick<LogicLine, 'change' | 'kind'>): LogicLine => ({
  depth: 0,
  line: 1,
  ...line,
});

test('a guard or catch removed from an edited function is a logic finding to look at on its file, one per decision, its detail the text', () => {
  const symbols = [
    symbolFile([
      {
        name: 'charge',
        scope: 'Orders',
        kind: 'method',
        exported: { base: true, head: true },
        change: 'edited',
        logic: [
          logicLine({ change: 'removed', kind: 'guard', base: 'if (!order.paid) return' }),
          logicLine({ change: 'same', kind: 'guard', head: 'if (!order) throw new Missing()' }),
          logicLine({ change: 'removed', kind: 'if', base: 'if (order.total > 0)' }),
          logicLine({ change: 'removed', kind: 'catch', base: 'catch (error)' }),
        ],
      },
    ]),
  ];

  expect(
    findingsOfSymbols(symbols).filter(({ id }) => id.startsWith('logic:removed:')),
  ).toStrictEqual([
    {
      id: 'logic:removed:web/file/a.ts#Orders.charge#if (!order.paid) return',
      dimension: 'logic',
      level: 'look',
      target: 'web/file/a.ts',
      title: 'method Orders.charge lost a guard',
      detail: 'if (!order.paid) return',
    },
    {
      id: 'logic:removed:web/file/a.ts#Orders.charge#catch (error)',
      dimension: 'logic',
      level: 'look',
      target: 'web/file/a.ts',
      title: 'method Orders.charge lost a catch',
      detail: 'catch (error)',
    },
  ]);
});

test("two identical decisions removed from one function are two findings, each id counting the function's lines that read the same up to it, as its decision anchor's does", () => {
  const lost = logicLine({ change: 'removed', kind: 'catch', base: 'catch (error)' });
  const moved = logicLine({ change: 'added', kind: 'catch', head: 'catch (error)' });
  const symbols = [
    symbolFile([
      {
        name: 'charge',
        kind: 'function',
        exported: { base: true, head: true },
        change: 'edited',
        logic: [moved, lost, logicLine({ change: 'same', kind: 'if', head: 'if (a)' }), lost],
      },
    ]),
  ];

  expect(
    findingsOfSymbols(symbols)
      .filter(({ id }) => id.startsWith('logic:removed:'))
      .map(({ id }) => id),
  ).toStrictEqual([
    'logic:removed:web/file/a.ts#charge#catch (error)#2',
    'logic:removed:web/file/a.ts#charge#catch (error)#3',
  ]);
});

test("a guard lost by each of two same-named symbols is two findings, the later one's id counting the symbol", () => {
  const accessor = {
    name: 'x',
    scope: 'C',
    kind: 'method' as const,
    exported: { base: false, head: false },
    change: 'edited' as const,
    logic: [logicLine({ change: 'removed', kind: 'guard', base: 'if (a) return' })],
  };

  expect(
    findingsOfSymbols([symbolFile([accessor, accessor])])
      .filter(({ id }) => id.startsWith('logic:removed:'))
      .map(({ id }) => id),
  ).toStrictEqual([
    'logic:removed:web/file/a.ts#C.x#if (a) return',
    'logic:removed:web/file/a.ts#C.x#2#if (a) return',
  ]);
});

test("an edited function's other decision changes are one logic finding for information on its file, its detail counting them; a function that only lost a guard has none", () => {
  const symbols = [
    symbolFile([
      {
        name: 'charge',
        kind: 'function',
        exported: { base: true, head: true },
        change: 'edited',
        logic: [
          logicLine({ change: 'added', kind: 'if', head: 'if (order.late)' }),
          logicLine({ change: 'same', kind: 'loop', head: 'for (const item of items)' }),
          logicLine({ change: 'changed', kind: 'ternary', base: 'a > 0 ?', head: 'a >= 0 ?' }),
          logicLine({ change: 'added', kind: 'throw', head: 'throw new Late' }),
          logicLine({ change: 'removed', kind: 'return', base: 'return' }),
        ],
      },
      {
        name: 'refund',
        kind: 'function',
        exported: { base: false, head: false },
        change: 'edited',
        logic: [
          logicLine({ change: 'removed', kind: 'guard', base: 'if (!paid) return' }),
          logicLine({ change: 'same', kind: 'if', head: 'if (order.late)' }),
        ],
      },
      {
        name: 'total',
        kind: 'function',
        exported: { base: false, head: false },
        change: 'edited',
        logic: [logicLine({ change: 'changed', kind: 'if', base: 'if (a)', head: 'if (b)' })],
      },
    ]),
  ];

  expect(findingsOfSymbols(symbols).filter(({ level }) => level === 'info')).toStrictEqual([
    {
      id: 'logic:changed:web/file/a.ts#charge',
      dimension: 'logic',
      level: 'info',
      target: 'web/file/a.ts',
      title: 'function charge changed its logic',
      detail: '2 added, 1 changed, 1 removed',
    },
    {
      id: 'logic:changed:web/file/a.ts#total',
      dimension: 'logic',
      level: 'info',
      target: 'web/file/a.ts',
      title: 'function total changed its logic',
      detail: '1 changed',
    },
  ]);
});

test("a moved guard or catch needs no look: it counts in its function's logic finding for information, which says how it was found", () => {
  const symbols = [
    symbolFile([
      {
        name: 'ReviewPage',
        kind: 'function',
        exported: { base: true, head: true },
        change: 'edited',
        logic: [
          logicLine({ change: 'moved', kind: 'guard', base: 'if (!a) return', movedTo: 'Page' }),
          logicLine({ change: 'moved', kind: 'catch', base: 'catch (error)', movedTo: 'Page' }),
          logicLine({ change: 'added', kind: 'if', head: 'if (b)' }),
        ],
      },
    ]),
  ];

  expect(findingsOfSymbols(symbols).filter(({ dimension }) => dimension === 'logic')).toStrictEqual(
    [
      {
        id: 'logic:changed:web/file/a.ts#ReviewPage',
        dimension: 'logic',
        level: 'info',
        target: 'web/file/a.ts',
        title: 'function ReviewPage changed its logic',
        detail: '1 added, 2 moved (found by text)',
      },
    ],
  );
});

test('two accessors of one name each changing their logic are two findings, the later id counting the symbol and each title naming its kind', () => {
  const accessor = (kind: 'getter' | 'setter'): SymbolStatement => ({
    name: 'x',
    scope: 'C',
    kind,
    exported: { base: false, head: false },
    change: 'edited',
    logic: [logicLine({ change: 'changed', kind: 'if', base: 'if (a)', head: 'if (b)' })],
  });

  expect(
    findingsOfSymbols([symbolFile([accessor('getter'), accessor('setter')])])
      .filter(({ id }) => id.startsWith('logic:changed:'))
      .map(({ id, title }) => ({ id, title })),
  ).toStrictEqual([
    { id: 'logic:changed:web/file/a.ts#C.x', title: 'getter C.x changed its logic' },
    { id: 'logic:changed:web/file/a.ts#C.x#2', title: 'setter C.x changed its logic' },
  ]);
});

test("a file whose logic changed, with no test added, removed or edited alongside it, is a tests finding to look at on it; a test file alongside that wouldn't parse counts as changed", () => {
  const edited = (name: string): SymbolStatement => ({
    name,
    kind: 'function',
    exported: { base: false, head: false },
    change: 'edited',
    logic: [logicLine({ change: 'added', kind: 'if', head: 'if (late)' })],
  });
  const symbols = [
    symbolFile([edited('charge')]),
    { ...symbolFile([edited('refund')]), node: 'web/file/b.ts' },
    { ...symbolFile([edited('total')]), node: 'web/file/c.ts' },
    {
      ...symbolFile([
        { name: 'pay', kind: 'function', exported: { base: true }, change: 'removed' },
      ]),
      node: 'web/file/d.ts',
    },
  ];
  const tests: ReadonlyArray<TestFile> = [
    {
      path: 'web/src/a.test.ts',
      stack: 'web',
      statements: [
        {
          kind: 'heading',
          name: 'charge',
          children: [{ kind: 'test', name: 'charges late orders', change: 'edited' }],
        },
      ],
    },
    {
      path: 'web/src/b.test.ts',
      stack: 'web',
      statements: [{ kind: 'test', name: 'refunds', change: 'unchanged' }],
    },
    { path: 'web/src/c.test.ts', stack: 'web', unreadable: 'Unexpected token (1:1)' },
  ];

  expect(
    findingsOfSymbols(symbols, tests).filter(({ dimension }) => dimension === 'tests'),
  ).toStrictEqual([
    {
      id: 'tests:untested-logic:web/file/b.ts',
      dimension: 'tests',
      level: 'look',
      target: 'web/file/b.ts',
      title: 'logic changed with no test changed alongside',
    },
  ]);
});

const notesFile = 'x.notes.json';

const notesWith = (notes: ReviewNotes['notes']): ReviewNotes => ({
  version: 1,
  summary: [],
  tests: '',
  notes,
});

const viewer = readFileSync(join(import.meta.dirname, '..', 'viewer', 'viewer.html'), 'utf8');

const slotsOf = (html: string) => {
  const document = new DOMParser().parseFromString(html, 'text/html');
  return (id: string) => document.getElementById(id)?.textContent ?? undefined;
};

test('the page holds its data whole, a range that closes a script tag included, and no notes or serve token until they are filled', () => {
  const data = pageData({
    repo: 'shop',
    reading: readingWith({}),
    range: 'main..x</script><b>',
    version,
    parsers,
  });

  expect(pageIn(slotsOf(pageHtml({ viewer, data })))).toStrictEqual({
    data,
    notes: undefined,
    token: undefined,
  });
});

test('a served page gives back the token serve filled in, beside its data and notes', () => {
  const data = pageData({
    repo: 'shop',
    reading: readingWith({}),
    range: 'main..feature',
    version,
    parsers,
  });
  const notes = notesWith({ 'web/file/a.ts': { text: 'Reads well.' } });
  const page = notedPageHtml({ page: pageHtml({ viewer, data }), notes, notesFile, version });

  expect(pageIn(slotsOf(servedPageHtml({ page, token: 'f00d', version })))).toStrictEqual({
    data,
    notes,
    token: 'f00d',
  });
});

test('notes filled into a page come back whole, a note holding replacement patterns such as $& included, beside its data', () => {
  const data = pageData({
    repo: 'shop',
    reading: readingWith({}),
    range: 'main..feature',
    version,
    parsers,
  });
  const notes = notesWith({ 'web/file/a.ts': { text: "Costs $& more, and $' too." } });

  const page = notedPageHtml({ page: pageHtml({ viewer, data }), notes, notesFile, version });

  expect(pageIn(slotsOf(page))).toStrictEqual({ data, notes, token: undefined });
});

const pageFor = (pageVersion: string) =>
  pageHtml({
    viewer,
    data: pageData({
      repo: 'shop',
      reading: readingWith({}),
      range: 'main..feature',
      version: pageVersion,
      parsers,
    }),
  });

test('notes for a page another visual-review wrote, one from before serve included, are refused, naming its version', () => {
  const unservable = pageFor('0.4.1').replace(
    '<script type="application/json" id="review-serve">null</script>',
    '',
  );

  expect(() =>
    notedPageHtml({ page: unservable, notes: notesWith({}), notesFile, version }),
  ).toThrow(
    'The page for main..feature was written by visual-review 0.4.1: run visual-review without --notes first',
  );
});

test('a page another visual-review wrote is not served, naming its version', () => {
  expect(() => servedPageHtml({ page: pageFor('0.4.1'), token: 'f00d', version })).toThrow(
    'The page for main..feature was written by visual-review 0.4.1: run visual-review again to serve it',
  );
});

test('notes for a page written before pages named their version are refused', () => {
  const older = pageFor(version).replace(`"version":"${version}",`, '');

  expect(() => notedPageHtml({ page: older, notes: notesWith({}), notesFile, version })).toThrow(
    'The page for main..feature was written by an older visual-review: run visual-review without --notes first',
  );
});

test('notes that leave a touched part without a note are refused, naming the notes file and the part', () => {
  expect(() =>
    notedPageHtml({ page: pageFor(version), notes: notesWith({}), notesFile, version }),
  ).toThrow("Notes in x.notes.json don't match the graph:\nno note on web/file/a.ts");
});

test("notes on a later round's page may answer what its last review said, and only that", () => {
  const page = pageHtml({
    viewer,
    data: {
      ...pageData({
        repo: 'shop',
        reading: readingWith({}),
        range: 'main..feature',
        version,
        parsers,
      }),
      sinceReview: {
        head: 'h1',
        verdict: 'comment',
        comments: [
          { anchor: { kind: 'part', id: 'web/file/a.ts' }, kind: 'question', text: 'Why?' },
        ],
        calledFine: [],
        gone: true,
      },
    },
  });
  const answering = (key: string) => ({
    ...notesWith({ 'web/file/a.ts': { text: 'Reads well.' } }),
    answers: { [key]: { status: 'answered', text: 'To keep the format.' } as const },
  });

  expect(() =>
    notedPageHtml({ page, notes: answering('part web/file/a.ts'), notesFile, version }),
  ).not.toThrow();
  expect(() =>
    notedPageHtml({ page, notes: answering('part web/file/b.ts'), notesFile, version }),
  ).toThrow('unknown comment part web/file/b.ts');
});

test("notes on a first round's page may not list unasked changes", () => {
  const page = pageHtml({
    viewer,
    data: pageData({
      repo: 'shop',
      reading: readingWith({}),
      range: 'main..feature',
      version,
      parsers,
    }),
  });
  const notes = {
    ...notesWith({ 'web/file/a.ts': { text: 'Reads well.' } }),
    unasked: { 'web/file/a.ts': { text: 'Renamed the helper.' } },
  };

  expect(() => notedPageHtml({ page, notes, notesFile, version })).toThrow('this page has none');
});

test('a changed node that is a file on both sides gets its churn on each', () => {
  const graph = { nodes: [webStack, webFile('a.ts'), webFile('b.ts')], edges: [] };
  const reading = readingWith({
    before: graph,
    after: graph,
    churn: {
      before: { 'web/src/a.ts': 3, 'web/src/b.ts': 1 },
      after: { 'web/src/a.ts': 4, 'web/src/b.ts': 1 },
    },
  });

  expect(
    pageData({ repo: 'shop', reading, range: 'main..feature', version, parsers }).metrics[
      'web/file/a.ts'
    ],
  ).toEqual({
    base: { churn: 3, fanIn: 0, fanOut: 0 },
    head: { churn: 4, fanIn: 0, fanOut: 0 },
  });
});

test("a measured file gets, beside its churn, its lines, functions, highest and total cyclomatic, each function's cyclomatic in the file's order, and the size of its summed ABC parts to one decimal, on each side", () => {
  const graph = { nodes: [webStack, webFile('a.ts')], edges: [] };
  const fn = (
    name: string,
    cyclomatic: number,
    [assignments, branches, conditions]: readonly [number, number, number],
  ) => ({ name, cyclomatic, abc: { assignments, branches, conditions } });
  const reading = readingWith({
    before: graph,
    after: graph,
    churn: { before: { 'web/src/a.ts': 3 }, after: { 'web/src/a.ts': 4 } },
    measures: {
      before: { 'web/src/a.ts': { lines: 7, functions: [fn('refund', 2, [3, 4, 0])] } },
      after: {
        'web/src/a.ts': {
          lines: 9,
          functions: [fn('split', 1, [1, 0, 2]), fn('refund', 3, [1, 2, 0])],
        },
      },
    },
  });

  expect(
    pageData({ repo: 'shop', reading, range: 'main..feature', version, parsers }).metrics[
      'web/file/a.ts'
    ],
  ).toEqual({
    base: {
      churn: 3,
      fanIn: 0,
      fanOut: 0,
      lines: 7,
      functions: 1,
      cyclomatic: { highest: 2, total: 2, byFunction: [{ name: 'refund', cyclomatic: 2 }] },
      abc: 5,
    },
    head: {
      churn: 4,
      fanIn: 0,
      fanOut: 0,
      lines: 9,
      functions: 2,
      cyclomatic: {
        highest: 3,
        total: 4,
        byFunction: [
          { name: 'split', cyclomatic: 1 },
          { name: 'refund', cyclomatic: 3 },
        ],
      },
      abc: 3.5,
    },
  });
});

test("a function's earlyReturns, where its reader counts them, sit beside its cyclomatic", () => {
  const abc = { assignments: 0, branches: 0, conditions: 0 };
  const reading = readingWith({
    churn: { before: {}, after: { 'web/src/a.ts': 1 } },
    measures: {
      before: {},
      after: {
        'web/src/a.ts': {
          lines: 4,
          functions: [
            { name: 'load', cyclomatic: 1, earlyReturns: 4, abc },
            { name: 'plain', cyclomatic: 2, abc },
          ],
        },
      },
    },
  });

  const { head } =
    pageData({ repo: 'shop', reading, range: 'main..feature', version, parsers }).metrics[
      'web/file/a.ts'
    ] ?? {};

  expect(head && 'lines' in head && head.cyclomatic.byFunction).toEqual([
    { name: 'load', cyclomatic: 1, earlyReturns: 4 },
    { name: 'plain', cyclomatic: 2 },
  ]);
});

test("a measured node's fan-in and fan-out count that side's edges into and out of it, an edge to another stack included", () => {
  const files = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'].map(webFile);
  const routes: GraphNode = {
    id: 'rust/mod/api/routes',
    kind: 'module',
    label: 'routes',
    path: 'api/src/routes.rs',
  };
  const nodes = [webStack, ...files, routes];
  const edge = (from: string, to: string) => ({ from: `web/file/${from}`, to: `web/file/${to}` });
  const churn = Object.fromEntries(files.map(({ path }) => [path, 1]));
  const reading = readingWith({
    before: { nodes, edges: [edge('b.ts', 'a.ts')] },
    after: {
      nodes,
      edges: [
        edge('b.ts', 'a.ts'),
        edge('d.ts', 'a.ts'),
        edge('a.ts', 'c.ts'),
        edge('a.ts', 'e.ts'),
        { from: 'web/file/a.ts', to: routes.id },
      ],
    },
    churn: { before: churn, after: churn },
  });

  expect(
    pageData({ repo: 'shop', reading, range: 'main..feature', version, parsers }).metrics[
      'web/file/a.ts'
    ],
  ).toEqual({
    base: { churn: 1, fanIn: 1, fanOut: 0 },
    head: { churn: 1, fanIn: 2, fanOut: 3 },
  });
});

test('a measured file with no functions has a highest and total cyclomatic of 0 and an ABC size of 0', () => {
  const graph = { nodes: [webStack, webFile('a.ts')], edges: [] };
  const reading = readingWith({
    before: graph,
    after: graph,
    churn: { before: {}, after: { 'web/src/a.ts': 1 } },
    measures: { before: {}, after: { 'web/src/a.ts': { lines: 2, functions: [] } } },
  });

  expect(
    pageData({ repo: 'shop', reading, range: 'main..feature', version, parsers }).metrics[
      'web/file/a.ts'
    ],
  ).toEqual({
    head: {
      churn: 1,
      fanIn: 0,
      fanOut: 0,
      lines: 2,
      functions: 0,
      cyclomatic: { highest: 0, total: 0, byFunction: [] },
      abc: 0,
    },
  });
});

test.for([
  {
    reason: 'an added file gets churn on the head side only',
    before: [webStack],
    after: [webStack, webFile('a.ts')],
    churn: { before: {}, after: { 'web/src/a.ts': 2 } },
    metrics: { head: { churn: 2, fanIn: 0, fanOut: 0 } },
  },
  {
    reason: 'a removed file gets churn on the base side only',
    before: [webStack, webFile('a.ts')],
    after: [webStack],
    churn: { before: { 'web/src/a.ts': 2 }, after: {} },
    metrics: { base: { churn: 2, fanIn: 0, fanOut: 0 } },
  },
])('$reason', ({ before, after, churn, metrics }) => {
  const reading = readingWith({
    before: { nodes: before, edges: [] },
    after: { nodes: after, edges: [] },
    churn,
  });

  expect(
    pageData({ repo: 'shop', reading, range: 'main..feature', version, parsers }).metrics[
      'web/file/a.ts'
    ],
  ).toStrictEqual(metrics);
});

test("an unchanged file one edge from a changed node, on either side's edges, gets its churn too, and one two edges away does not", () => {
  const files = ['a.ts', 'b.ts', 'c.ts', 'd.ts'].map(webFile);
  const edge = (from: string, to: string) => ({ from: `web/file/${from}`, to: `web/file/${to}` });
  const churn = Object.fromEntries(files.map(({ path }) => [path, 1]));
  const reading = readingWith({
    before: { nodes: [webStack, ...files], edges: [edge('b.ts', 'a.ts')] },
    after: { nodes: [webStack, ...files], edges: [edge('a.ts', 'c.ts'), edge('c.ts', 'd.ts')] },
    churn: { before: churn, after: churn },
  });

  const { metrics } = pageData({ repo: 'shop', reading, range: 'main..feature', version, parsers });

  expect(Object.keys(metrics).filter(id => id.startsWith('web/file/'))).toEqual([
    'web/file/a.ts',
    'web/file/b.ts',
    'web/file/c.ts',
  ]);
});

test("a renamed file's base churn is read at the path it had on the base side", () => {
  const reading = readingWith({
    before: { nodes: [webStack, webFile('old.ts')], edges: [] },
    after: { nodes: [webStack, webFile('a.ts')], edges: [] },
    changedPaths: ['web/src/old.ts', 'web/src/a.ts'],
    renames: [{ from: 'web/src/old.ts', to: 'web/src/a.ts' }],
    churn: { before: { 'web/src/old.ts': 5 }, after: { 'web/src/a.ts': 1 } },
  });

  expect(
    pageData({ repo: 'shop', reading, range: 'main..feature', version, parsers }).metrics[
      'web/file/a.ts'
    ],
  ).toEqual({
    base: { churn: 5, fanIn: 0, fanOut: 0 },
    head: { churn: 1, fanIn: 0, fanOut: 0 },
  });
});

test("a node whose file moved with no rename git saw reads its base churn at its base path, not at another file's", () => {
  const moved = { ...webFile('a.ts'), path: 'web/src/old.ts' };
  const reading = readingWith({
    before: { nodes: [webStack, moved, { ...webFile('b.ts'), path: 'web/src/a.ts' }], edges: [] },
    after: { nodes: [webStack, webFile('a.ts')], edges: [] },
    changedPaths: ['web/src/old.ts', 'web/src/a.ts'],
    churn: { before: { 'web/src/old.ts': 5, 'web/src/a.ts': 9 }, after: { 'web/src/a.ts': 1 } },
  });

  expect(
    pageData({ repo: 'shop', reading, range: 'main..feature', version, parsers }).metrics[
      'web/file/a.ts'
    ],
  ).toEqual({
    base: { churn: 5, fanIn: 0, fanOut: 0 },
    head: { churn: 1, fanIn: 0, fanOut: 0 },
  });
});

test('a box gets, on each side, the highest churn among the measured nodes inside it at any depth, marked as such, with nothing on a side where none inside is measured, and nothing for a box with none measured inside', () => {
  const files = [webFile('b.ts'), box('n'), inBox('n', 'c.ts')];
  const reading = readingWith({
    before: { nodes: [webStack, ...files], edges: [] },
    after: { nodes: [webStack, box('m'), inBox('m', 'a.ts'), ...files], edges: [] },
    changedPaths: ['web/src/m/a.ts', 'web/src/b.ts'],
    churn: {
      before: { 'web/src/b.ts': 1, 'web/src/n/c.ts': 9 },
      after: { 'web/src/m/a.ts': 5, 'web/src/b.ts': 4, 'web/src/n/c.ts': 9 },
    },
  });

  const { metrics } = pageData({ repo: 'shop', reading, range: 'main..feature', version, parsers });

  expect(metrics).toStrictEqual({
    web: {
      highestInside: true,
      base: { churn: 1, fanIn: 0, fanOut: 0 },
      head: { churn: 5, fanIn: 0, fanOut: 0 },
    },
    'web/box/m': { highestInside: true, head: { churn: 5, fanIn: 0, fanOut: 0 } },
    'web/file/m/a.ts': { head: { churn: 5, fanIn: 0, fanOut: 0 } },
    'web/file/b.ts': {
      base: { churn: 1, fanIn: 0, fanOut: 0 },
      head: { churn: 4, fanIn: 0, fanOut: 0 },
    },
  });
});

test('a box takes, on each side, the highest of each measure among the measured leaves inside it, its complexity from the leaves a reader measured', () => {
  const fn = (cyclomatic: number, assignments: number) => ({
    name: 'f',
    cyclomatic,
    abc: { assignments, branches: 0, conditions: 0 },
  });
  const files = [inBox('m', 'a.ts'), inBox('m', 'b.ts'), inBox('m', 'c.ts')];
  const reading = readingWith({
    after: {
      nodes: [webStack, box('m'), ...files],
      edges: [
        { from: 'web/file/m/a.ts', to: 'web/file/m/b.ts' },
        { from: 'web/file/m/c.ts', to: 'web/file/m/b.ts' },
      ],
    },
    changedPaths: files.map(({ path }) => path),
    churn: {
      before: {},
      after: { 'web/src/m/a.ts': 2, 'web/src/m/b.ts': 7, 'web/src/m/c.ts': 1 },
    },
    measures: {
      before: {},
      after: {
        'web/src/m/a.ts': { lines: 10, functions: [fn(5, 5)] },
        'web/src/m/b.ts': { lines: 20, functions: [fn(3, 1), fn(3, 0)] },
      },
    },
  });

  expect(
    pageData({ repo: 'shop', reading, range: 'main..feature', version, parsers }).metrics[
      'web/box/m'
    ],
  ).toEqual({
    highestInside: true,
    head: {
      churn: 7,
      fanIn: 2,
      fanOut: 1,
      lines: 20,
      functions: 2,
      cyclomatic: { highest: 5, total: 6 },
      abc: 5,
    },
  });
});

type FileOfA = {
  readonly churn: number;
  readonly cyclomatic: number;
  readonly lines?: number;
  readonly abc?: number;
};

const readingOfA = ({
  base,
  head,
  thresholds,
}: {
  readonly base: FileOfA | undefined;
  readonly head: FileOfA | undefined;
  readonly thresholds: RangeReading['thresholds'];
}): RangeReading => {
  const measured = (file: FileOfA | undefined) =>
    file === undefined
      ? {}
      : {
          'web/src/a.ts': {
            lines: file.lines ?? 1,
            functions: [
              {
                name: 'f',
                cyclomatic: file.cyclomatic,
                abc: { assignments: file.abc ?? 0, branches: 0, conditions: 0 },
              },
              { name: 'g', cyclomatic: 1, abc: { assignments: 0, branches: 0, conditions: 0 } },
            ],
          },
        };
  const churned = (file: FileOfA | undefined) =>
    file === undefined ? {} : { 'web/src/a.ts': file.churn };
  const nodes = (file: FileOfA | undefined) =>
    file === undefined ? [webStack] : [webStack, webFile('a.ts')];
  return readingWith({
    before: { nodes: nodes(base), edges: [] },
    after: { nodes: nodes(head), edges: [] },
    churn: { before: churned(base), after: churned(head) },
    measures: { before: measured(base), after: measured(head) },
    thresholds,
  });
};

const splitPageOf = (names: ReadonlyArray<string>) =>
  pageData({
    repo: 'shop',
    reading: readingWith({
      after: {
        nodes: [webStack, ...names.map(webFile)],
        edges: [
          { from: 'web/file/a.ts', to: 'web/file/b.ts' },
          { from: 'web/file/c.ts', to: 'web/file/d.ts' },
        ],
      },
      thresholds: { cyclomatic: 10, splitParts: 2, hotspot: { churn: 6, cyclomatic: 8 } },
    }),
    range: 'main..feature',
    version,
    parsers,
  }).findings.find(finding => finding.dimension === 'cohesion');

test('parts that fall into separate groups raise one cohesion finding for information, with no target, holding the groups and counting the parts left out', () => {
  expect(splitPageOf(['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'])).toStrictEqual({
    id: 'cohesion:split',
    dimension: 'cohesion',
    level: 'info',
    title: 'may be 2 independent changes',
    detail: expect.stringContaining('1 part in smaller groups'),
    groups: [
      ['web/file/b.ts', 'web/file/a.ts'],
      ['web/file/d.ts', 'web/file/c.ts'],
    ],
  });
});

test('with no part left out, the detail counts none', () => {
  expect(splitPageOf(['a.ts', 'b.ts', 'c.ts', 'd.ts'])?.detail).not.toContain('smaller groups');
});

test.for([
  { reason: 'a new file over it is one to look at', base: undefined, head: 5, level: 'look' },
  { reason: 'a file that crosses it is one to look at', base: 4, head: 5, level: 'look' },
  { reason: 'a file over it that grew is one to look at', base: 5, head: 6, level: 'look' },
  { reason: 'a file over it that held is for information', base: 5, head: 5, level: 'info' },
  { reason: 'a file over it that shrank is for information', base: 6, head: 5, level: 'info' },
  { reason: 'a file at it raises none', base: 6, head: 4, level: undefined },
  { reason: 'a removed file raises none', base: 6, head: undefined, level: undefined },
])(
  'against the cyclomatic threshold, $reason, and the boxes above it raise none',
  ({ base, head, level }) => {
    const file = (cyclomatic: number | undefined) =>
      cyclomatic === undefined ? undefined : { churn: 1, cyclomatic };
    const reading = readingOfA({
      base: file(base),
      head: file(head),
      thresholds: { cyclomatic: 4, splitParts: 4, hotspot: { churn: 6, cyclomatic: 8 } },
    });

    expect(
      metricFindings(pageData({ repo: 'shop', reading, range: 'main..feature', version, parsers })),
    ).toStrictEqual(
      level === undefined
        ? []
        : [
            {
              node: 'web/file/a.ts',
              metric: 'cyclomatic',
              level,
              ...(base === undefined ? {} : { base }),
              head,
              threshold: 4,
            },
          ],
    );
  },
);

test.for([
  {
    reason: 'a new file that reaches both is one to look at',
    base: undefined,
    head: { churn: 3, cyclomatic: 5 },
    level: 'look',
  },
  {
    reason: 'a file just under the churn raises none',
    base: undefined,
    head: { churn: 2, cyclomatic: 5 },
    level: undefined,
  },
  {
    reason: 'a file just under the cyclomatic raises none',
    base: undefined,
    head: { churn: 3, cyclomatic: 4 },
    level: undefined,
  },
  {
    reason: 'a file that churn made one is one to look at',
    base: { churn: 2, cyclomatic: 6 },
    head: { churn: 3, cyclomatic: 6 },
    level: 'look',
  },
  {
    reason: 'a hotspot that got more complex is one to look at',
    base: { churn: 3, cyclomatic: 5 },
    head: { churn: 3, cyclomatic: 6 },
    level: 'look',
  },
  {
    reason: 'a hotspot that churned more but held its complexity is for information',
    base: { churn: 3, cyclomatic: 5 },
    head: { churn: 4, cyclomatic: 5 },
    level: 'info',
  },
  {
    reason: 'a removed hotspot raises none',
    base: { churn: 3, cyclomatic: 5 },
    head: undefined,
    level: undefined,
  },
])('as a hotspot, $reason, and the boxes above it raise none', ({ base, head, level }) => {
  const threshold = { churn: 3, cyclomatic: 5 };
  const reading = readingOfA({
    base,
    head,
    thresholds: { cyclomatic: 20, splitParts: 4, hotspot: threshold },
  });

  expect(
    metricFindings(pageData({ repo: 'shop', reading, range: 'main..feature', version, parsers })),
  ).toStrictEqual(
    level === undefined || head === undefined
      ? []
      : [
          {
            node: 'web/file/a.ts',
            metric: 'hotspot',
            level,
            ...(base === undefined ? {} : { base }),
            head,
            threshold,
          },
        ],
  );
});

test.for([
  {
    reason: 'a file past the lines threshold is reported against it',
    thresholds: { lines: 100 },
    base: { lines: 100 },
    head: { lines: 101 },
    findings: [{ metric: 'lines', level: 'look', base: 100, head: 101, threshold: 100 }],
  },
  {
    reason: 'a file past the abc threshold is reported against it',
    thresholds: { abc: 10 },
    base: { abc: 12 },
    head: { abc: 12 },
    findings: [{ metric: 'abc', level: 'info', base: 12, head: 12, threshold: 10 }],
  },
  {
    reason: 'with neither set, no file is reported for its lines or abc',
    thresholds: {},
    base: { lines: 1000, abc: 1000 },
    head: { lines: 1000, abc: 1000 },
    findings: [],
  },
])('$reason', ({ thresholds, base, head, findings }) => {
  const reading = readingOfA({
    base: { churn: 1, cyclomatic: 1, ...base },
    head: { churn: 1, cyclomatic: 1, ...head },
    thresholds: {
      cyclomatic: 10,
      splitParts: 4,
      hotspot: { churn: 6, cyclomatic: 8 },
      ...thresholds,
    },
  });

  expect(
    metricFindings(pageData({ repo: 'shop', reading, range: 'main..feature', version, parsers })),
  ).toStrictEqual(findings.map(finding => ({ node: 'web/file/a.ts', ...finding })));
});

test.for([
  {
    reason: 'a file that changed',
    base: { churn: 2, cyclomatic: 4, abc: 31.46 },
    said: [
      { level: 'look', title: 'cyclomatic 4 → 14, over 4' },
      { level: 'look', title: 'hotspot, churn 2 → 3 and cyclomatic 4 → 14, over 3 and 5' },
      { level: 'info', title: 'ABC size 31.5 → 31.5, over 30' },
    ],
  },
  {
    reason: 'a new file',
    base: undefined,
    said: [
      { level: 'look', title: 'cyclomatic 14, over 4' },
      { level: 'look', title: 'hotspot, churn 3 and cyclomatic 14, over 3 and 5' },
      { level: 'look', title: 'ABC size 31.5, over 30' },
    ],
  },
])(
  'lists each metric finding on $reason as a metrics finding on its node, titled by what moved past which threshold',
  ({ base, said }) => {
    const reading = readingOfA({
      base,
      head: { churn: 3, cyclomatic: 14, abc: 31.46 },
      thresholds: { cyclomatic: 4, splitParts: 4, hotspot: { churn: 3, cyclomatic: 5 }, abc: 30 },
    });

    expect(
      pageData({ repo: 'shop', reading, range: 'main..feature', version, parsers }).findings,
    ).toStrictEqual(
      ['cyclomatic', 'hotspot', 'abc'].map((metric, at) => ({
        id: `metrics:${metric}:web/file/a.ts`,
        dimension: 'metrics',
        target: 'web/file/a.ts',
        ...said[at],
      })),
    );
  },
);

const nothingDropped = { nodes: [], edges: [] };

const reviewedAt = ({
  pullRequest,
  ...overrides
}: Pick<ReviewedDiff, 'before' | 'changedPaths'> &
  Partial<Pick<ReviewedDiff, 'renames' | 'symbols' | 'tests'>> & {
    readonly pullRequest?: Partial<ReviewedDiff>;
  }): ReviewedReading => ({
  ...reviewedHead(),
  commits: [],
  renames: [],
  symbols: [],
  tests: [],
  ...overrides,
  pullRequest: {
    before: overrides.before,
    changedPaths: [],
    renames: [],
    symbols: [],
    tests: [],
    ...pullRequest,
  },
});

test.for([
  {
    since: 'a commit touches a part the PR changes',
    changedPaths: ['web/src/a.ts'],
    nodes: ['web/file/a.ts'],
  },
  {
    since: 'nothing touches the PR parts, as when main is merged in and touches only c.ts',
    changedPaths: ['web/src/c.ts'],
    nodes: [],
  },
])('page data lists what changed since the last review when $since', ({ changedPaths, nodes }) => {
  const reading = readingWith({
    before: { nodes: [webStack, webFile('c.ts')], edges: [] },
    after: { nodes: [webStack, webFile('a.ts'), webFile('b.ts'), webFile('c.ts')], edges: [] },
    changedPaths: ['web/src/a.ts', 'web/src/b.ts'],
    reviewed: reviewedAt({
      before: { nodes: [webStack, webFile('a.ts'), webFile('b.ts'), webFile('c.ts')], edges: [] },
      changedPaths,
    }),
  });

  expect(
    pageData({ repo: 'shop', reading, range: 'a..b', version: '1.2.3', parsers: {} }).sinceReview,
  ).toMatchObject({
    head: 'h1',
    verdict: 'comment',
    changed: { nodes, edges: [], dropped: nothingDropped },
  });
});

test.for([
  {
    since: "main's merge touches another file in a box the PR changes",
    pullRequest: ['web/src/pkg/b.ts'],
    changedPaths: ['web/src/pkg/c.ts'],
    nodes: [],
  },
  {
    since: "main's merge touches a box's own file where the PR changes a file in it",
    pullRequest: ['web/src/pkg/b.ts'],
    changedPaths: ['web/src/pkg/style.css'],
    nodes: [],
  },
  {
    since: 'a commit touches the file the PR changes in that box',
    pullRequest: ['web/src/pkg/b.ts'],
    changedPaths: ['web/src/pkg/b.ts', 'web/src/pkg/c.ts'],
    nodes: ['web/box/pkg', 'web/file/pkg/b.ts'],
  },
  {
    since: 'a commit touches a box the PR changes only outside its files',
    pullRequest: ['web/src/pkg/style.css'],
    changedPaths: ['web/src/pkg/style.css'],
    nodes: ['web/box/pkg'],
  },
  {
    since: "a commit touches only a box's own file where the PR also changes a file in it",
    pullRequest: ['web/src/pkg/b.ts', 'web/src/pkg/style.css'],
    changedPaths: ['web/src/pkg/style.css'],
    nodes: ['web/box/pkg'],
  },
])(
  'page data counts a box as changed since only through paths the PR changes, when $since',
  ({ pullRequest, changedPaths, nodes }) => {
    const graph = {
      nodes: [webStack, box('pkg'), inBox('pkg', 'b.ts'), inBox('pkg', 'c.ts')],
      edges: [],
    };
    const reading = readingWith({
      before: graph,
      after: graph,
      changedPaths: pullRequest,
      reviewed: reviewedAt({ before: graph, changedPaths }),
    });

    expect(
      pageData({ repo: 'shop', reading, range: 'a..b', version: '1.2.3', parsers: {} }).sinceReview,
    ).toMatchObject({
      head: 'h1',
      verdict: 'comment',
      changed: { nodes, edges: [], dropped: nothingDropped },
    });
  },
);

test("page data leaves out a file main's merge added since the last review", () => {
  const merged = { nodes: [webStack, webFile('a.ts'), webFile('c.ts')], edges: [] };
  const reading = readingWith({
    before: { nodes: [webStack, webFile('c.ts')], edges: [] },
    after: merged,
    changedPaths: ['web/src/a.ts'],
    reviewed: reviewedAt({
      before: { nodes: [webStack, webFile('a.ts')], edges: [] },
      changedPaths: ['web/src/c.ts'],
    }),
  });

  expect(
    pageData({ repo: 'shop', reading, range: 'a..b', version: '1.2.3', parsers: {} }).sinceReview,
  ).toMatchObject({
    head: 'h1',
    verdict: 'comment',
    changed: { nodes: [], edges: [], dropped: nothingDropped },
  });
});

test("page data lists the PR's added or removed edges that came or went since the last review, not the ones it already had or the ones main brought", () => {
  const [a, b, c] = ['web/file/a.ts', 'web/file/b.ts', 'web/file/c.ts'];
  const files = [webStack, webFile('a.ts'), webFile('b.ts'), webFile('c.ts')];
  const reading = readingWith({
    before: {
      nodes: files,
      edges: [
        { from: c, to: a },
        { from: b, to: c },
      ],
    },
    after: {
      nodes: files,
      edges: [
        { from: a, to: b },
        { from: a, to: c },
        { from: c, to: a },
      ],
    },
    changedPaths: [],
    reviewed: reviewedAt({
      before: {
        nodes: files,
        edges: [
          { from: a, to: b },
          { from: b, to: c },
        ],
      },
      changedPaths: [],
    }),
  });

  expect(
    pageData({ repo: 'shop', reading, range: 'a..b', version: '1.2.3', parsers: {} }).sinceReview,
  ).toMatchObject({
    head: 'h1',
    verdict: 'comment',
    changed: { nodes: [], edges: [`${a} -> ${c}`, `${b} -> ${c}`], dropped: nothingDropped },
  });
});

test('page data lists a part the PR edited at the last review and has since restored, which the head draws as unchanged', () => {
  const graph = { nodes: [webStack, webFile('a.ts')], edges: [] };
  const reading = readingWith({
    before: graph,
    after: graph,
    changedPaths: [],
    reviewed: reviewedAt({
      before: graph,
      changedPaths: ['web/src/a.ts'],
      pullRequest: { before: graph, changedPaths: ['web/src/a.ts'], renames: [] },
    }),
  });

  expect(
    pageData({ repo: 'shop', reading, range: 'a..b', version: '1.2.3', parsers: {} }).sinceReview,
  ).toMatchObject({
    head: 'h1',
    verdict: 'comment',
    changed: { nodes: ['web/file/a.ts'], edges: [], dropped: nothingDropped },
  });
});

test('page data lists a file the PR renamed at the last review and has since renamed back', () => {
  const [a, b] = ['web/src/a.ts', 'web/src/b.ts'];
  const graph = { nodes: [webStack, webFile('a.ts')], edges: [] };
  const atReview = { nodes: [webStack, webFile('b.ts')], edges: [] };
  const reading = readingWith({
    before: graph,
    after: graph,
    changedPaths: [],
    reviewed: reviewedAt({
      before: atReview,
      changedPaths: [b, a],
      renames: [{ from: b, to: a }],
      pullRequest: { before: graph, changedPaths: [a, b], renames: [{ from: a, to: b }] },
    }),
  });

  expect(
    pageData({ repo: 'shop', reading, range: 'a..b', version: '1.2.3', parsers: {} }).sinceReview,
  ).toMatchObject({
    head: 'h1',
    verdict: 'comment',
    changed: { nodes: ['web/file/a.ts'], edges: [], dropped: nothingDropped },
  });
});

test.for([
  {
    end: 'its target',
    reviewedEdge: { from: 'web/file/use.ts', to: 'web/file/foo.ts' },
    named: 'web/file/use.ts -> web/file/baz.ts',
  },
  {
    end: 'its source',
    reviewedEdge: { from: 'web/file/foo.ts', to: 'web/file/use.ts' },
    named: 'web/file/baz.ts -> web/file/use.ts',
  },
])(
  'page data names by the new name an edge the PR added at the last review and has since removed, having renamed $end',
  ({ reviewedEdge, named }) => {
    const before = { nodes: [webStack, webFile('use.ts'), webFile('foo.ts')], edges: [] };
    const reading = readingWith({
      before,
      after: { nodes: [webStack, webFile('use.ts'), webFile('baz.ts')], edges: [] },
      changedPaths: ['web/src/foo.ts', 'web/src/baz.ts'],
      renames: [{ from: 'web/src/foo.ts', to: 'web/src/baz.ts' }],
      reviewed: reviewedAt({
        before: { ...before, edges: [reviewedEdge] },
        changedPaths: ['web/src/foo.ts', 'web/src/baz.ts'],
        renames: [{ from: 'web/src/foo.ts', to: 'web/src/baz.ts' }],
        pullRequest: { before, changedPaths: ['web/src/use.ts'], renames: [] },
      }),
    });

    expect(
      pageData({ repo: 'shop', reading, range: 'a..b', version: '1.2.3', parsers: {} }).sinceReview,
    ).toMatchObject({
      head: 'h1',
      verdict: 'comment',
      changed: {
        nodes: ['web/file/baz.ts'],
        edges: [],
        dropped: { nodes: [], edges: [named] },
      },
    });
  },
);

test('page data lists each class of a file the PR renamed at the last review and has since renamed back, whose ids never changed', () => {
  const [kept, moved] = ['web/src/kept.rb', 'web/src/moved.rb'];
  const classAt = (name: string, path: string): GraphNode => ({
    id: `web/class/${name}`,
    kind: 'file',
    label: name,
    parent: 'web',
    path,
  });
  const graphAt = (path: string) => ({
    nodes: [webStack, classAt('One', path), classAt('Two', path)],
    edges: [],
  });
  const reading = readingWith({
    before: graphAt(kept),
    after: graphAt(kept),
    changedPaths: [],
    reviewed: reviewedAt({
      before: graphAt(moved),
      changedPaths: [moved, kept],
      renames: [{ from: moved, to: kept }],
      pullRequest: {
        before: graphAt(kept),
        changedPaths: [kept, moved],
        renames: [{ from: kept, to: moved }],
      },
    }),
  });

  expect(
    pageData({ repo: 'shop', reading, range: 'a..b', version: '1.2.3', parsers: {} }).sinceReview,
  ).toMatchObject({
    head: 'h1',
    verdict: 'comment',
    changed: {
      nodes: ['web/class/One', 'web/class/Two'],
      edges: [],
      dropped: nothingDropped,
    },
  });
});

test('page data holds apart what the PR added at the last review and has since deleted, which the head has no way to draw', () => {
  const [a, b] = ['web/file/a.ts', 'web/file/b.ts'];
  const without = { nodes: [webStack, webFile('b.ts')], edges: [] };
  const atReview = {
    nodes: [webStack, webFile('a.ts'), webFile('b.ts')],
    edges: [{ from: a, to: b }],
  };
  const reading = readingWith({
    before: without,
    after: without,
    changedPaths: [],
    reviewed: reviewedAt({
      before: atReview,
      changedPaths: ['web/src/a.ts'],
      pullRequest: { before: without, changedPaths: ['web/src/a.ts'], renames: [] },
    }),
  });

  expect(
    pageData({ repo: 'shop', reading, range: 'a..b', version: '1.2.3', parsers: {} }).sinceReview,
  ).toMatchObject({
    head: 'h1',
    verdict: 'comment',
    changed: { nodes: [], edges: [], dropped: { nodes: [a], edges: [`${a} -> ${b}`] } },
  });
});

test('page data lists an edge the PR removed at the last review and has since put back', () => {
  const [a, b] = ['web/file/a.ts', 'web/file/b.ts'];
  const files = [webStack, webFile('a.ts'), webFile('b.ts')];
  const linked = { nodes: files, edges: [{ from: a, to: b }] };
  const reading = readingWith({
    before: linked,
    after: linked,
    changedPaths: [],
    reviewed: reviewedAt({
      before: { nodes: files, edges: [] },
      changedPaths: [],
      pullRequest: { before: linked, changedPaths: [], renames: [] },
    }),
  });

  expect(
    pageData({ repo: 'shop', reading, range: 'a..b', version: '1.2.3', parsers: {} }).sinceReview,
  ).toMatchObject({
    head: 'h1',
    verdict: 'comment',
    changed: { nodes: [], edges: [`${a} -> ${b}`], dropped: nothingDropped },
  });
});

test('page data says the reviewed head is gone when its commit no longer reads, and holds no last review when there was none', () => {
  const data = (overrides: Partial<RangeReading>) =>
    pageData({
      repo: 'shop',
      reading: readingWith(overrides),
      range: 'a..b',
      version: '1.2.3',
      parsers: {},
    });

  expect(data({ reviewed: { ...reviewedHead(), gone: true } }).sinceReview).toMatchObject({
    head: 'h1',
    gone: true,
  });
  expect(
    data({ reviewed: { ...reviewedHead(), unreadable: 'cargo metadata failed' } }).sinceReview,
  ).toMatchObject({ head: 'h1', unreadable: 'cargo metadata failed' });
  expect(data({})).not.toHaveProperty('sinceReview');
});

test.for([
  { side: 'whose commit is gone', reading: { gone: true as const } },
  { side: 'that no longer reads', reading: { unreadable: 'cargo metadata failed' } },
  {
    side: 'still compared',
    reading: reviewedAt({
      before: { nodes: [webStack, webFile('a.ts')], edges: [] },
      changedPaths: [],
    }),
  },
])('page data keeps what the last review said at a head $side', ({ reading }) => {
  const said = {
    verdict: 'request-changes' as const,
    body: 'Nearly there',
    comments: [
      {
        anchor: { kind: 'part' as const, id: 'web/file/a.ts' },
        kind: 'change' as const,
        text: 'Split this',
      },
    ],
    calledFine: ['logic:changed:web/file/a.ts#run'],
  };

  const { sinceReview } = pageData({
    repo: 'shop',
    reading: readingWith({ reviewed: { ...reviewedHead(), ...reading, ...said } }),
    range: 'a..b',
    version: '1.2.3',
    parsers: {},
  });

  expect(sinceReview).toMatchObject({
    verdict: 'request-changes',
    body: 'Nearly there',
    calledFine: ['logic:changed:web/file/a.ts#run'],
  });
  expect(sinceReview?.comments).toEqual([{ ...said.comments[0], target: 'web/file/a.ts' }]);
});

test.for([
  {
    since: 'a file the PR changes edited since, by its patch',
    paths: ['web/src/a.ts'],
    patches: ['web/src/a.ts'],
    files: ['web/src/a.ts'],
    dropped: [],
  },
  {
    since: 'a file only a merge touched',
    paths: ['web/src/c.ts'],
    patches: ['web/src/a.ts'],
    files: [],
    dropped: [],
  },
  {
    since: 'a file restored since, which the head has no patch of',
    paths: ['web/src/b.ts'],
    patches: ['web/src/a.ts'],
    files: [],
    dropped: ['web/src/b.ts'],
  },
  {
    since: 'a file outside the graph, by its patch too',
    paths: ['README.md'],
    patches: ['README.md'],
    files: ['README.md'],
    dropped: [],
  },
])('changed since lists $since', ({ paths, patches, files, dropped }) => {
  const graph = { nodes: [webStack, webFile('a.ts')], edges: [] };
  const reading = readingWith({
    before: graph,
    after: graph,
    changedPaths: ['web/src/a.ts', 'README.md'],
    patches: patches.map(patch),
    reviewed: reviewedAt({
      before: graph,
      changedPaths: paths,
      pullRequest: { changedPaths: ['web/src/a.ts', 'web/src/b.ts'] },
    }),
  });

  expect(
    pageData({ repo: 'shop', reading, range: 'a..b', version: '1.2.3', parsers: {} }).sinceReview,
  ).toMatchObject({ changed: { files, dropped: { files: dropped } } });
});

test('changed since lists a file renamed since by its new name alone', () => {
  const [from, to] = ['web/src/a.ts', 'web/src/b.ts'];
  const graph = { nodes: [webStack, webFile('a.ts')], edges: [] };
  const reading = readingWith({
    before: graph,
    after: graph,
    changedPaths: [from, to],
    patches: [patch(to)],
    reviewed: reviewedAt({
      before: graph,
      changedPaths: [from, to],
      renames: [{ from, to }],
    }),
  });

  expect(
    pageData({ repo: 'shop', reading, range: 'a..b', version: '1.2.3', parsers: {} }).sinceReview,
  ).toMatchObject({ changed: { files: [to], dropped: { files: [] } } });
});

const commitOn = (sha: string, ...files: ReadonlyArray<string>) => ({
  sha,
  subject: `Subject of ${sha}`,
  files,
});

const onAPart = (id: string): Review['comments'][number] => ({
  anchor: { kind: 'part', id },
  kind: 'change',
  text: 'Look at this',
});

const firstPrevious = (reading: RangeReading) => {
  const { sinceReview } = pageData({
    repo: 'shop',
    reading,
    range: 'a..b',
    version: '1.2.3',
    parsers: {},
  });
  return sinceReview?.comments[0];
};

test.for([
  {
    on: 'a part changed since, with the commits on its file',
    id: 'web/file/a.ts',
    target: 'web/file/a.ts',
    changedSince: [commitOn('c1', 'web/src/a.ts')],
  },
  {
    on: 'a part with a part changed inside it, which no commit touches itself',
    id: 'web',
    target: 'web',
    changedSince: [commitOn('c1', 'web/src/a.ts')],
  },
  { on: 'a part as it was', id: 'web/file/b.ts', target: 'web/file/b.ts' },
])('a previous comment on $on', ({ id, target, changedSince }) => {
  const graph = {
    nodes: [webStack, webFile('a.ts'), webFile('b.ts'), webFile('main.ts')],
    edges: [],
  };
  const previous = firstPrevious(
    readingWith({
      before: { nodes: [webStack, webFile('main.ts')], edges: [] },
      after: graph,
      changedPaths: ['web/src/a.ts', 'web/src/b.ts'],
      reviewed: {
        ...reviewedAt({ before: graph, changedPaths: ['web/src/a.ts', 'web/src/main.ts'] }),
        comments: [onAPart(id)],
        commits: [
          commitOn('c1', 'web/src/a.ts'),
          commitOn('c2', 'web/src/elsewhere.ts'),
          commitOn('merged', 'web/src/main.ts'),
        ],
      },
    }),
  );

  expect(previous).toEqual({ ...onAPart(id), target, ...(changedSince && { changedSince }) });
});

test('a previous comment on a part renamed since goes by its new name, with the commits on both', () => {
  const [before, after] = [webFile('a.ts'), webFile('b.ts')];
  const [from, to] = [before.path, after.path];
  const previous = firstPrevious(
    readingWith({
      before: { nodes: [webStack], edges: [] },
      after: { nodes: [webStack, after], edges: [] },
      changedPaths: [to],
      reviewed: {
        ...reviewedAt({
          before: { nodes: [webStack, before], edges: [] },
          changedPaths: [from, to],
          renames: [{ from, to }],
        }),
        comments: [onAPart(before.id)],
        commits: [commitOn('c1', from), commitOn('c2', to)],
      },
    }),
  );

  expect(previous).toMatchObject({
    target: after.id,
    changedSince: [commitOn('c1', from), commitOn('c2', to)],
  });
});

const gone = webFile('a.ts');

test.for([
  {
    on: 'a part gone since holds no target and reads as changed',
    id: gone.id,
    atFork: [webStack],
    held: {},
  },
  {
    on: "a part gone with main's merge, which the PR never changed, reads as changed too",
    id: gone.id,
    atFork: [webStack, gone],
    held: {},
  },
  {
    on: 'a part holding one gone since reads as changed, and is still its target',
    id: 'web',
    atFork: [webStack],
    held: { target: 'web' },
  },
])('a previous comment on $on', ({ id, atFork, held }) => {
  const previous = firstPrevious(
    readingWith({
      before: { nodes: [webStack], edges: [] },
      after: { nodes: [webStack], edges: [] },
      changedPaths: [],
      reviewed: {
        ...reviewedAt({
          before: { nodes: [webStack, gone], edges: [] },
          changedPaths: [gone.path],
          pullRequest: {
            before: { nodes: atFork, edges: [] },
            changedPaths: atFork.length === 1 ? [gone.path] : [],
          },
        }),
        comments: [onAPart(id)],
        commits: [commitOn('c1', gone.path)],
      },
    }),
  );

  expect(previous).toEqual({
    ...onAPart(id),
    ...held,
    changedSince: [commitOn('c1', gone.path)],
  });
});

const [fileA, fileB, fileC] = [webFile('a.ts'), webFile('b.ts'), webFile('c.ts')];
const apiStack: GraphNode = { id: 'api', kind: 'stack', label: 'api', path: '' };
const apiFile: GraphNode = {
  id: 'api/file/x.ts',
  kind: 'file',
  label: 'x.ts',
  parent: 'api',
  path: 'api/src/x.ts',
};
const edgeNodes = [webStack, fileA, fileB, fileC, apiStack, apiFile];
const edgeBetween = (from: GraphNode, to: GraphNode) => ({ from: from.id, to: to.id });
const onAnEdge = (from: GraphNode, to: GraphNode): Review['comments'][number] => ({
  anchor: { kind: 'edge', id: `${from.id} -> ${to.id}` },
  kind: 'question',
  text: 'Why this way?',
});
const commitsOnEveryFile = [
  commitOn('c1', fileA.path),
  commitOn('c2', fileB.path),
  commitOn('c3', fileC.path),
  commitOn('c4', apiFile.path),
];

test.for([
  {
    on: 'an edge added since, with the commits on both its ends',
    comment: onAnEdge(fileA, fileB),
    atReview: [],
    atHead: [edgeBetween(fileA, fileB)],
    changedSince: ['c1', 'c2'],
  },
  {
    on: 'an edge removed since, which the head has no edge of',
    comment: onAnEdge(fileA, fileB),
    atReview: [edgeBetween(fileA, fileB)],
    atHead: [],
    changedSince: ['c1', 'c2'],
  },
  {
    on: 'a merged edge between boxes, with an edge running inside it changed',
    comment: onAnEdge(webStack, apiStack),
    atReview: [],
    atHead: [edgeBetween(fileA, apiFile)],
    changedSince: ['c1', 'c2', 'c3', 'c4'],
  },
  {
    on: 'an edge with changed edges sharing only its from or only its to, as it was',
    comment: onAnEdge(fileA, fileB),
    atReview: [edgeBetween(fileA, fileB)],
    atHead: [edgeBetween(fileA, fileB), edgeBetween(fileA, fileC), edgeBetween(fileC, fileB)],
  },
  {
    on: 'an edge between boxes with a changed edge the other way, as it was',
    comment: onAnEdge(webStack, apiStack),
    atReview: [],
    atHead: [edgeBetween(apiFile, fileA)],
  },
])('a previous comment on $on', ({ comment, atReview, atHead, changedSince }) => {
  const previous = firstPrevious(
    readingWith({
      before: { nodes: edgeNodes, edges: [] },
      after: { nodes: edgeNodes, edges: atHead },
      changedPaths: [fileA.path, fileB.path, fileC.path, apiFile.path],
      reviewed: {
        ...reviewedAt({
          before: { nodes: edgeNodes, edges: atReview },
          changedPaths: [fileA.path, fileB.path, fileC.path, apiFile.path],
          pullRequest: { before: { nodes: edgeNodes, edges: [] } },
        }),
        comments: [comment],
        commits: commitsOnEveryFile,
      },
    }),
  );

  expect(previous).toEqual({
    ...comment,
    target: comment.anchor.id,
    ...(changedSince && {
      changedSince: commitsOnEveryFile.filter(({ sha }) => changedSince.includes(sha)),
    }),
  });
});

test.for([
  { end: 'from', comment: onAnEdge(fileA, fileB) },
  { end: 'to', comment: onAnEdge(fileB, fileA) },
])(
  'a previous comment on an edge with its $end gone since holds no target and reads as changed',
  ({ comment }) => {
    const previous = firstPrevious(
      readingWith({
        before: { nodes: [webStack, fileB], edges: [] },
        after: { nodes: [webStack, fileB], edges: [] },
        changedPaths: [fileB.path],
        reviewed: {
          ...reviewedAt({
            before: { nodes: [webStack, fileA, fileB], edges: [] },
            changedPaths: [fileA.path],
          }),
          comments: [comment],
          commits: [commitOn('c1', fileA.path)],
        },
      }),
    );

    expect(previous).toEqual({ ...comment, changedSince: [commitOn('c1', fileA.path)] });
  },
);

test('a previous comment on an edge with an end renamed since goes by its new name, with the commits on both', () => {
  const comment = onAnEdge(fileA, fileB);
  const previous = firstPrevious(
    readingWith({
      before: { nodes: [webStack, fileB], edges: [] },
      after: { nodes: [webStack, fileC, fileB], edges: [edgeBetween(fileC, fileB)] },
      changedPaths: [fileC.path, fileB.path],
      reviewed: {
        ...reviewedAt({
          before: { nodes: [webStack, fileA, fileB], edges: [edgeBetween(fileA, fileB)] },
          changedPaths: [fileA.path, fileC.path],
          renames: [{ from: fileA.path, to: fileC.path }],
        }),
        comments: [comment],
        commits: [commitOn('c1', fileA.path), commitOn('c2', fileC.path)],
      },
    }),
  );

  expect(previous).toMatchObject({
    target: `${fileC.id} -> ${fileB.id}`,
    changedSince: [commitOn('c1', fileA.path), commitOn('c2', fileC.path)],
  });
});

const anchorGraph = {
  nodes: [webStack, webFile('a.ts'), webFile('b.ts')],
  edges: [],
};

const anchorFile = (name: string, symbols: ReadonlyArray<SymbolStatement>): SymbolFile => ({
  ...symbolFile(symbols),
  node: `web/file/${name}`,
});

const fn = (
  name: string,
  change: SymbolStatement['change'],
  more: Partial<SymbolStatement> = {},
): SymbolStatement => ({ name, kind: 'function', exported: {}, change, ...more });

test.for([
  {
    case: 'a function edited since, edited in the PR too',
    since: [fn('f', 'edited')],
    head: [fn('f', 'edited')],
    atReview: [fn('f', 'edited')],
    symbols: ['web/file/a.ts#f'],
    dropped: [],
  },
  {
    case: 'a function edited in the PR but not since',
    since: [fn('f', 'unchanged')],
    head: [fn('f', 'edited')],
    atReview: [fn('f', 'edited')],
    symbols: [],
    dropped: [],
  },
  {
    case: 'a function only reformatted since',
    since: [fn('f', 'formatting')],
    head: [fn('f', 'edited')],
    atReview: [fn('f', 'edited')],
    symbols: [],
    dropped: [],
  },
  {
    case: 'a function a merge edited, which the PR leaves alone at either head',
    since: [fn('f', 'edited')],
    head: [fn('f', 'unchanged'), fn('g', 'edited')],
    atReview: [fn('f', 'unchanged'), fn('g', 'edited')],
    symbols: [],
    dropped: [],
  },
  {
    case: 'a function the PR changes only at the new head',
    since: [fn('f', 'edited')],
    head: [fn('f', 'edited')],
    atReview: [fn('f', 'unchanged')],
    symbols: ['web/file/a.ts#f'],
    dropped: [],
  },
  {
    case: 'a function reverted since, still in a file the PR changes',
    since: [fn('f', 'edited')],
    head: [fn('f', 'unchanged'), fn('g', 'edited')],
    atReview: [fn('f', 'edited')],
    symbols: ['web/file/a.ts#f'],
    dropped: [],
  },
  {
    case: 'a function reverted since, in a file the PR no longer changes',
    since: [fn('f', 'edited')],
    head: [],
    atReview: [fn('f', 'edited')],
    symbols: [],
    dropped: ['web/file/a.ts#f'],
  },
  {
    case: 'a function renamed back since, by its new name',
    since: [fn('g', 'renamed', { renamedFrom: 'f' })],
    head: [fn('g', 'unchanged'), fn('h', 'edited')],
    atReview: [fn('f', 'renamed', { renamedFrom: 'g' })],
    symbols: ['web/file/a.ts#g'],
    dropped: [],
  },
])('changed since lists symbols: $case', ({ since, head, atReview, symbols, dropped }) => {
  const reading = readingWith({
    before: anchorGraph,
    after: anchorGraph,
    changedPaths: ['web/src/a.ts'],
    symbols: head.length === 0 ? [] : [anchorFile('a.ts', head)],
    reviewed: reviewedAt({
      before: anchorGraph,
      changedPaths: ['web/src/a.ts'],
      symbols: [anchorFile('a.ts', since)],
      pullRequest: { symbols: [anchorFile('a.ts', atReview)] },
    }),
  });

  expect(
    pageData({ repo: 'shop', reading, range: 'a..b', version: '1.2.3', parsers: {} }).sinceReview,
  ).toMatchObject({ changed: { symbols, dropped: { symbols: dropped } } });
});

test('changed since finds a function moved back since by the file it was in at the review', () => {
  const reading = readingWith({
    before: anchorGraph,
    after: anchorGraph,
    changedPaths: ['web/src/a.ts', 'web/src/b.ts'],
    symbols: [anchorFile('a.ts', [fn('f', 'unchanged'), fn('g', 'edited')])],
    reviewed: reviewedAt({
      before: anchorGraph,
      changedPaths: ['web/src/a.ts', 'web/src/b.ts'],
      symbols: [anchorFile('a.ts', [fn('f', 'moved', { movedFrom: 'web/file/b.ts' })])],
      pullRequest: {
        symbols: [anchorFile('b.ts', [fn('f', 'moved', { movedFrom: 'web/file/a.ts' })])],
      },
    }),
  });

  expect(
    pageData({ repo: 'shop', reading, range: 'a..b', version: '1.2.3', parsers: {} }).sinceReview,
  ).toMatchObject({ changed: { symbols: ['web/file/a.ts#f'] } });
});

test('changed since finds a function in a file renamed since by its name at the review', () => {
  const reviewedGraph = { nodes: [webStack, webFile('old.ts')], edges: [] };
  const headGraph = { nodes: [webStack, webFile('new.ts')], edges: [] };
  const reading = readingWith({
    before: { nodes: [webStack], edges: [] },
    after: headGraph,
    changedPaths: ['web/src/new.ts'],
    symbols: [anchorFile('new.ts', [fn('f', 'unchanged'), fn('g', 'edited')])],
    reviewed: reviewedAt({
      before: reviewedGraph,
      changedPaths: ['web/src/old.ts', 'web/src/new.ts'],
      renames: [{ from: 'web/src/old.ts', to: 'web/src/new.ts' }],
      symbols: [anchorFile('new.ts', [fn('f', 'edited')])],
      pullRequest: {
        before: { nodes: [webStack], edges: [] },
        changedPaths: ['web/src/old.ts'],
        symbols: [anchorFile('old.ts', [fn('f', 'edited')])],
      },
    }),
  });

  expect(
    pageData({ repo: 'shop', reading, range: 'a..b', version: '1.2.3', parsers: {} }).sinceReview,
  ).toMatchObject({ changed: { symbols: ['web/file/new.ts#f'] } });
});

test('changed since skips a file whose symbols could not be read', () => {
  const unreadable = { node: 'web/file/a.ts', stack: 'web', unreadable: 'SyntaxError' };
  const reading = readingWith({
    before: anchorGraph,
    after: anchorGraph,
    changedPaths: ['web/src/a.ts'],
    symbols: [unreadable],
    reviewed: reviewedAt({
      before: anchorGraph,
      changedPaths: ['web/src/a.ts'],
      symbols: [unreadable],
      pullRequest: { symbols: [unreadable] },
    }),
  });

  expect(
    pageData({ repo: 'shop', reading, range: 'a..b', version: '1.2.3', parsers: {} }).sinceReview,
  ).toMatchObject({ changed: { symbols: [], dropped: { symbols: [] } } });
});

const ifLine = (change: LogicLine['change'], base: string | undefined, head: string | undefined) =>
  logicLine({
    change,
    kind: 'if',
    ...(base === undefined ? {} : { base }),
    ...(head === undefined ? {} : { head }),
  });

const editedWith = (logic: ReadonlyArray<LogicLine>) => fn('f', 'edited', { logic });

const onSymbol = (id: string): Review['comments'][number] => ({
  anchor: { kind: 'symbol', id },
  kind: 'change',
  text: 'Look at this',
});

const onDecision = (id: string, text: string): Review['comments'][number] => ({
  anchor: { kind: 'decision', id, text },
  kind: 'question',
  text: 'Why this?',
});

test.for([
  {
    on: 'a symbol changed since',
    comment: onSymbol('web/file/a.ts#f'),
    since: [fn('f', 'edited')],
    head: [fn('f', 'edited')],
    changed: true,
  },
  {
    on: 'a symbol as it was',
    comment: onSymbol('web/file/a.ts#f'),
    since: [fn('f', 'unchanged')],
    head: [fn('f', 'edited')],
    changed: false,
  },
  {
    on: 'a symbol the head no longer holds',
    comment: onSymbol('web/file/a.ts#f'),
    since: [],
    head: [fn('g', 'edited')],
    changed: true,
  },
  {
    on: 'a decision changed since',
    comment: onDecision('web/file/a.ts#f#if (b)', 'if (b)'),
    since: [editedWith([ifLine('changed', 'if (a)', 'if (b)')])],
    head: [editedWith([ifLine('changed', 'if (z)', 'if (b)')])],
    changed: true,
  },
  {
    on: 'a decision as it was',
    comment: onDecision('web/file/a.ts#f#if (b)', 'if (b)'),
    since: [editedWith([ifLine('same', 'if (b)', 'if (b)')])],
    head: [editedWith([ifLine('changed', 'if (z)', 'if (b)')])],
    changed: false,
  },
  {
    on: 'a decision the head no longer holds',
    comment: onDecision('web/file/a.ts#f#if (b)', 'if (b)'),
    since: [],
    head: [editedWith([ifLine('changed', 'if (z)', 'if (c)')])],
    changed: true,
  },
])('a previous comment on $on', ({ comment, since, head, changed }) => {
  const commits = [commitOn('c1', 'web/src/a.ts'), commitOn('c2', 'web/src/b.ts')];
  const previous = firstPrevious(
    readingWith({
      before: anchorGraph,
      after: anchorGraph,
      changedPaths: ['web/src/a.ts'],
      symbols: [anchorFile('a.ts', head)],
      reviewed: {
        ...reviewedAt({
          before: anchorGraph,
          changedPaths: ['web/src/a.ts'],
          symbols: [anchorFile('a.ts', since)],
          pullRequest: { symbols: [anchorFile('a.ts', head)] },
        }),
        comments: [comment],
        commits,
      },
    }),
  );

  expect(previous).toEqual({
    ...comment,
    target: 'web/file/a.ts',
    ...(changed && { changedSince: [commitOn('c1', 'web/src/a.ts')] }),
  });
});

test('a previous comment on a symbol in a file renamed since goes by the new file, with the commits on both', () => {
  const previous = firstPrevious(
    readingWith({
      before: { nodes: [webStack], edges: [] },
      after: { nodes: [webStack, webFile('new.ts')], edges: [] },
      changedPaths: ['web/src/new.ts'],
      symbols: [anchorFile('new.ts', [fn('f', 'edited')])],
      reviewed: {
        ...reviewedAt({
          before: { nodes: [webStack, webFile('old.ts')], edges: [] },
          changedPaths: ['web/src/old.ts', 'web/src/new.ts'],
          renames: [{ from: 'web/src/old.ts', to: 'web/src/new.ts' }],
        }),
        comments: [onSymbol('web/file/old.ts#f')],
        commits: [commitOn('c1', 'web/src/old.ts'), commitOn('c2', 'web/src/new.ts')],
      },
    }),
  );

  expect(previous).toMatchObject({
    target: 'web/file/new.ts',
    changedSince: [commitOn('c1', 'web/src/old.ts'), commitOn('c2', 'web/src/new.ts')],
  });
});

test.for([
  {
    case: 'a line changed since, the same at the review',
    since: [ifLine('changed', 'if (a)', 'if (b)'), ifLine('same', 'if (c)', 'if (c)')],
    head: editedWith([ifLine('changed', 'if (z)', 'if (b)'), ifLine('same', 'if (c)', 'if (c)')]),
    decisions: ['web/file/a.ts#f#if (b)'],
    dropped: [],
  },
  {
    case: 'a line changed since that the head reads as the same, a revert',
    since: [ifLine('changed', 'if (a)', 'if (b)')],
    head: editedWith([ifLine('same', 'if (b)', 'if (b)'), ifLine('added', undefined, 'if (c)')]),
    decisions: ['web/file/a.ts#f#if (b)'],
    dropped: [],
  },
  {
    case: 'a line changed since, still in a function the PR adds, which has no lines',
    since: [ifLine('changed', 'if (a > 0)', 'if (a > 1)')],
    head: fn('f', 'added'),
    decisions: [],
    dropped: [],
  },
  {
    case: 'a line removed since, gone from the head',
    since: [ifLine('removed', 'if (gone)', undefined)],
    head: editedWith([ifLine('added', undefined, 'if (other)')]),
    decisions: [],
    dropped: ['web/file/a.ts#f#if (gone)'],
  },
])('changed since lists decisions: $case', ({ since, head, decisions, dropped }) => {
  const reading = readingWith({
    before: anchorGraph,
    after: anchorGraph,
    changedPaths: ['web/src/a.ts'],
    symbols: [anchorFile('a.ts', [head])],
    reviewed: reviewedAt({
      before: anchorGraph,
      changedPaths: ['web/src/a.ts'],
      symbols: [anchorFile('a.ts', [editedWith(since)])],
    }),
  });

  expect(
    pageData({ repo: 'shop', reading, range: 'a..b', version: '1.2.3', parsers: {} }).sinceReview,
  ).toMatchObject({ changed: { decisions, dropped: { decisions: dropped } } });
});

test('changed since lists no decision of a function a merge edited', () => {
  const line = ifLine('changed', 'if (a)', 'if (b)');
  const reading = readingWith({
    before: anchorGraph,
    after: anchorGraph,
    changedPaths: ['web/src/a.ts'],
    symbols: [
      anchorFile('a.ts', [fn('f', 'unchanged', { logic: [ifLine('same', 'if (b)', 'if (b)')] })]),
    ],
    reviewed: reviewedAt({
      before: anchorGraph,
      changedPaths: ['web/src/a.ts'],
      symbols: [anchorFile('a.ts', [fn('f', 'edited', { logic: [line] })])],
    }),
  });

  expect(
    pageData({ repo: 'shop', reading, range: 'a..b', version: '1.2.3', parsers: {} }).sinceReview,
  ).toMatchObject({ changed: { symbols: [], decisions: [], dropped: { decisions: [] } } });
});

const testOf = (name: string, change: 'added' | 'removed' | 'edited' | 'unchanged') => ({
  kind: 'test' as const,
  name,
  change,
});

const testFile = (
  path: string,
  statements: Extract<TestFile, { statements: unknown }>['statements'],
  renamedFrom?: string,
): TestFile => ({ path, stack: 'web', renamedFrom, statements });

const headed = (...children: ReadonlyArray<ReturnType<typeof testOf>>) => [
  { kind: 'heading' as const, name: 'cart', children },
];

test.for([
  {
    case: 'a test edited since, edited in the PR too, by its heading trail',
    since: headed(testOf('adds', 'edited')),
    head: headed(testOf('adds', 'edited')),
    atReview: headed(testOf('adds', 'edited')),
    tests: ['web/a.test.ts#cart › adds'],
    dropped: [],
  },
  {
    case: 'a test edited in the PR but not since',
    since: headed(testOf('adds', 'unchanged')),
    head: headed(testOf('adds', 'edited')),
    atReview: headed(testOf('adds', 'edited')),
    tests: [],
    dropped: [],
  },
  {
    case: 'a test a merge edited, which the PR leaves alone at either head',
    since: headed(testOf('adds', 'edited')),
    head: headed(testOf('adds', 'unchanged'), testOf('other', 'edited')),
    atReview: headed(testOf('adds', 'unchanged'), testOf('other', 'edited')),
    tests: [],
    dropped: [],
  },
  {
    case: 'a test the PR changes only at the new head',
    since: headed(testOf('adds', 'edited')),
    head: headed(testOf('adds', 'edited')),
    atReview: headed(testOf('adds', 'unchanged')),
    tests: ['web/a.test.ts#cart › adds'],
    dropped: [],
  },
  {
    case: 'a test reverted since, in a file the PR still changes',
    since: headed(testOf('adds', 'edited')),
    head: headed(testOf('adds', 'unchanged'), testOf('other', 'edited')),
    atReview: headed(testOf('adds', 'edited')),
    tests: ['web/a.test.ts#cart › adds'],
    dropped: [],
  },
  {
    case: 'a test added in the PR and removed since',
    since: headed(testOf('adds', 'removed')),
    head: headed(testOf('other', 'edited')),
    atReview: headed(testOf('adds', 'added')),
    tests: [],
    dropped: ['web/a.test.ts#cart › adds'],
  },
  {
    case: 'the second of two tests of one name, by its count',
    since: headed(testOf('adds', 'unchanged'), testOf('adds', 'edited')),
    head: headed(testOf('adds', 'unchanged'), testOf('adds', 'edited')),
    atReview: headed(testOf('adds', 'unchanged'), testOf('adds', 'edited')),
    tests: ['web/a.test.ts#cart › adds#2'],
    dropped: [],
  },
])('changed since lists tests: $case', ({ since, head, atReview, tests, dropped }) => {
  const reading = readingWith({
    before: anchorGraph,
    after: anchorGraph,
    changedPaths: ['web/a.test.ts'],
    tests: [testFile('web/a.test.ts', head)],
    reviewed: reviewedAt({
      before: anchorGraph,
      changedPaths: ['web/a.test.ts'],
      tests: [testFile('web/a.test.ts', since)],
      pullRequest: { tests: [testFile('web/a.test.ts', atReview)] },
    }),
  });

  expect(
    pageData({ repo: 'shop', reading, range: 'a..b', version: '1.2.3', parsers: {} }).sinceReview,
  ).toMatchObject({ changed: { tests, dropped: { tests: dropped } } });
});

test('changed since finds a test in a file renamed since by its path at the review', () => {
  const [from, to] = ['web/old.test.ts', 'web/new.test.ts'];
  const reading = readingWith({
    before: anchorGraph,
    after: anchorGraph,
    changedPaths: [to],
    tests: [testFile(to, headed(testOf('adds', 'unchanged'), testOf('other', 'edited')))],
    reviewed: reviewedAt({
      before: anchorGraph,
      changedPaths: [from, to],
      renames: [{ from, to }],
      tests: [testFile(to, headed(testOf('adds', 'edited')), from)],
      pullRequest: { tests: [testFile(from, headed(testOf('adds', 'edited')))] },
    }),
  });

  expect(
    pageData({ repo: 'shop', reading, range: 'a..b', version: '1.2.3', parsers: {} }).sinceReview,
  ).toMatchObject({ changed: { tests: [`${to}#cart › adds`] } });
});

const onTest = (id: string): Review['comments'][number] => ({
  anchor: { kind: 'test', id },
  kind: 'change',
  text: 'Assert more',
});

const onLine = (id: string, text: string): Review['comments'][number] => ({
  anchor: { kind: 'line', id, text },
  kind: 'question',
  text: 'Why this?',
});

const commitsOnTwoFiles = (first: string) => [
  commitOn('c1', first),
  commitOn('c2', 'web/src/b.ts'),
];

test.for([
  {
    on: 'a test changed since',
    since: headed(testOf('adds', 'edited')),
    head: headed(testOf('adds', 'edited')),
    changed: true,
  },
  {
    on: 'a test as it was',
    since: headed(testOf('adds', 'unchanged')),
    head: headed(testOf('adds', 'edited')),
    changed: false,
  },
  {
    on: 'a test the head no longer holds',
    since: headed(testOf('adds', 'removed')),
    head: headed(testOf('other', 'edited')),
    changed: true,
  },
])('a previous comment on $on', ({ since, head, changed }) => {
  const comment = onTest('web/a.test.ts#cart › adds');
  const commits = commitsOnTwoFiles('web/a.test.ts');
  const previous = firstPrevious(
    readingWith({
      before: anchorGraph,
      after: anchorGraph,
      changedPaths: ['web/a.test.ts'],
      tests: [testFile('web/a.test.ts', head)],
      reviewed: {
        ...reviewedAt({
          before: anchorGraph,
          changedPaths: ['web/a.test.ts'],
          tests: [testFile('web/a.test.ts', since)],
          pullRequest: { tests: [testFile('web/a.test.ts', head)] },
        }),
        comments: [comment],
        commits,
      },
    }),
  );

  expect(previous).toEqual({
    ...comment,
    target: 'web/file/a.ts',
    ...(changed && { changedSince: [commitOn('c1', 'web/a.test.ts')] }),
  });
});

test.for([
  {
    on: 'a diff line whose file changed since',
    patches: ['web/src/a.ts'],
    since: ['web/src/a.ts'],
    changed: true,
  },
  {
    on: 'a diff line whose file is as it was',
    patches: ['web/src/a.ts'],
    since: ['web/src/b.ts'],
    changed: false,
  },
  {
    on: 'a diff line in a file the PR no longer changes',
    patches: ['web/src/b.ts'],
    since: ['web/src/b.ts'],
    changed: true,
  },
])('a previous comment on $on', ({ patches, since, changed }) => {
  const comment = onLine('web/src/a.ts@head:3', 'if (open) return');
  const previous = firstPrevious(
    readingWith({
      before: anchorGraph,
      after: anchorGraph,
      changedPaths: ['web/src/a.ts', 'web/src/b.ts'],
      patches: patches.map(patch),
      reviewed: {
        ...reviewedAt({
          before: anchorGraph,
          changedPaths: since,
          pullRequest: { changedPaths: ['web/src/a.ts', 'web/src/b.ts'] },
        }),
        comments: [comment],
        commits: commitsOnTwoFiles('web/src/a.ts'),
      },
    }),
  );

  expect(previous).toEqual({
    ...comment,
    target: 'web/file/a.ts',
    ...(changed && { changedSince: [commitOn('c1', 'web/src/a.ts')] }),
  });
});

test.for([
  {
    on: 'a test',
    comment: onTest('web/old.test.ts#cart › adds'),
    from: 'web/old.test.ts',
    to: 'web/new.test.ts',
    target: 'web/file/new.ts',
  },
  {
    on: 'a diff line',
    comment: onLine('web/src/old.ts@base:3', 'if (open) return'),
    from: 'web/src/old.ts',
    to: 'web/src/new.ts',
    target: 'web/file/new.ts',
  },
])(
  'a previous comment on $on in a file renamed since goes by the new file, with the commits on both',
  ({ comment, from, to, target }) => {
    const graph = { nodes: [webStack, webFile('new.ts')], edges: [] };
    const previous = firstPrevious(
      readingWith({
        before: graph,
        after: graph,
        changedPaths: [to],
        patches: [patch(to)],
        tests: [testFile('web/new.test.ts', headed(testOf('adds', 'edited')))],
        reviewed: {
          ...reviewedAt({
            before: graph,
            changedPaths: [from, to],
            renames: [{ from, to }],
          }),
          comments: [comment],
          commits: [commitOn('c1', from), commitOn('c2', to), commitOn('c3', 'web/src/other.ts')],
        },
      }),
    );

    expect(previous).toMatchObject({
      target,
      changedSince: [commitOn('c1', from), commitOn('c2', to)],
    });
  },
);

test('changed since skips a test file that could not be read', () => {
  const unreadable = { path: 'web/a.test.ts', stack: 'web', unreadable: 'SyntaxError' };
  const reading = readingWith({
    before: anchorGraph,
    after: anchorGraph,
    changedPaths: ['web/a.test.ts'],
    tests: [unreadable],
    reviewed: reviewedAt({
      before: anchorGraph,
      changedPaths: ['web/a.test.ts'],
      tests: [unreadable],
      pullRequest: { tests: [unreadable] },
    }),
  });

  expect(
    pageData({ repo: 'shop', reading, range: 'a..b', version: '1.2.3', parsers: {} }).sinceReview,
  ).toMatchObject({ changed: { tests: [], dropped: { tests: [] } } });
});

const answering = (id: string): Review['comments'][number] => ({
  anchor: { kind: 'finding', id },
  kind: 'fine',
});

const answersReading = (id: string, reviewed: (graph: Graph) => ReviewedReading) => {
  const nodes = [webStack, webFile('a.ts'), webFile('b.ts')];
  return readingWith({
    before: { nodes: [webStack], edges: [] },
    after: { nodes, edges: [{ from: 'web/file/a.ts', to: 'web/file/b.ts' }] },
    changedPaths: ['web/src/a.ts', 'web/src/b.ts'],
    skipped: [{ reader: 'rust', tool: 'cargo', stacks: ['rust'] }],
    danglingCalls: [
      { from: 'web/file/a.ts', path: '/api/a' },
      { from: 'web/file/b.ts', path: '/api/b' },
    ],
    reviewed: { ...reviewed({ nodes, edges: [] }), comments: [answering(id)] },
  });
};

const commitOnA = commitOn('c1', 'web/src/a.ts');

test.for([
  {
    on: 'a finding on a part changed since, with the commits on it',
    id: 'routes:dangling:web/file/a.ts',
    mark: { target: 'web/file/a.ts', changedSince: [commitOnA] },
  },
  {
    on: 'a finding on a part as it was',
    id: 'routes:dangling:web/file/b.ts',
    mark: { target: 'web/file/b.ts' },
  },
  {
    on: 'a note flag on a part changed since, which the page data does not raise',
    id: 'notes:web/file/a.ts',
    mark: { target: 'web/file/a.ts', changedSince: [commitOnA] },
  },
  {
    on: 'a note flag on a part as it was, which the page data does not raise',
    id: 'notes:web/file/b.ts',
    mark: { target: 'web/file/b.ts' },
  },
  {
    on: 'a note flag on an edge changed since',
    id: 'notes:web/file/a.ts -> web/file/b.ts',
    mark: { target: 'web/file/a.ts -> web/file/b.ts', changedSince: [commitOnA] },
  },
  {
    on: 'a finding with no target, still raised, as it was',
    id: 'structure:skipped:rust',
    mark: {},
  },
  {
    on: 'a finding no longer raised, changed with no commit to name',
    id: 'routes:dangling:web/file/gone.ts',
    mark: { changedSince: [] },
  },
])('a previous answer to $on', ({ id, mark }) => {
  const previous = firstPrevious(
    answersReading(id, before => ({
      ...reviewedAt({ before, changedPaths: ['web/src/a.ts'] }),
      commits: [commitOnA, commitOn('c2', 'web/src/elsewhere.ts')],
    })),
  );

  expect(previous).toEqual({ ...answering(id), ...mark });
});

test.for([
  {
    on: 'a finding on a part',
    id: 'routes:dangling:web/file/a.ts',
    held: { target: 'web/file/a.ts' },
  },
  { on: 'a note flag on a part', id: 'notes:web/file/a.ts', held: { target: 'web/file/a.ts' } },
  { on: 'a finding no longer raised', id: 'routes:dangling:web/file/gone.ts', held: {} },
])('a previous answer to $on on a gone head keeps its target, with no mark', ({ id, held }) => {
  const previous = firstPrevious(answersReading(id, () => ({ ...reviewedHead(), gone: true })));

  expect(previous).toEqual({ ...answering(id), ...held });
});

test.for([
  {
    case: 'still in the function, read as moved, keeps its line and asks nothing new',
    logic: [ifLine('moved', 'if (gone)', undefined)],
    mark: { target: 'web/file/a.ts' },
    withoutComment: [],
  },
  {
    case: 'gone from the function is no longer raised, changed with no commit to name',
    logic: [],
    mark: { changedSince: [] },
    withoutComment: ['web/file/a.ts'],
  },
])('a previous answer to a lost decision $case', ({ logic, mark, withoutComment }) => {
  const id = 'logic:removed:web/file/a.ts#f#if (gone)';
  const reading = readingWith({
    before: anchorGraph,
    after: anchorGraph,
    changedPaths: ['web/src/a.ts'],
    symbols: [anchorFile('a.ts', [editedWith(logic)])],
    reviewed: {
      ...reviewedAt({ before: anchorGraph, changedPaths: ['web/src/a.ts'] }),
      comments: [answering(id)],
      commits: [commitOnA],
    },
  });

  const { sinceReview } = pageData({
    repo: 'shop',
    reading,
    range: 'a..b',
    version: '1.2.3',
    parsers: {},
  });

  expect(sinceReview?.comments).toEqual([{ ...answering(id), ...mark }]);
  expect(sinceReview).toMatchObject({ changedWithoutComment: withoutComment });
});

const boxed = {
  nodes: [webStack, box('cart'), inBox('cart', 'a.ts'), inBox('cart', 'b.ts'), webFile('c.ts')],
  edges: [],
};
const fileInBox = 'web/file/cart/a.ts';
const otherInBox = 'web/file/cart/b.ts';

test('a previous comment on a box lists the commits on the paths the PR changes in it, not one merged in beside them', () => {
  const previous = firstPrevious(
    readingWith({
      before: { nodes: [webStack], edges: [] },
      after: boxed,
      changedPaths: ['web/src/cart/a.ts', 'web/src/cart/b.ts'],
      patches: [{ path: 'web/src/cart/a.ts', patch: '@@ a' }],
      reviewed: {
        ...reviewedAt({
          before: boxed,
          changedPaths: ['web/src/cart/a.ts', 'web/src/cart/unrelated.ts'],
        }),
        comments: [onAPart(box('cart').id)],
        commits: [
          commitOn('c1', 'web/src/cart/a.ts'),
          commitOn('merged', 'web/src/cart/unrelated.ts'),
        ],
      },
    }),
  );

  expect(previous?.changedSince).toEqual([commitOn('c1', 'web/src/cart/a.ts')]);
});

const sinceWith = ({
  since,
  ...said
}: Partial<Pick<ReviewedHead, 'comments' | 'read'>> & { readonly since: ReadonlyArray<string> }) =>
  pageData({
    repo: 'shop',
    reading: readingWith({
      before: { nodes: [webStack], edges: [] },
      after: boxed,
      changedPaths: ['web/src/cart/a.ts', 'web/src/cart/b.ts', 'web/src/cart/notes.txt'],
      reviewed: { ...reviewedAt({ before: boxed, changedPaths: [...since] }), ...said },
    }),
    range: 'a..b',
    version: '1.2.3',
    parsers: {},
  }).sinceReview;

test.for([
  {
    with: 'no comment, naming the changed part and not the box around it',
    comments: [],
    listed: [fileInBox],
  },
  { with: 'a comment on it', comments: [onAPart(fileInBox)], listed: [] },
  { with: 'a comment on a box around it', comments: [onAPart('web/box/cart')], listed: [] },
  {
    with: 'a comment on a symbol in it, which counts by its node',
    comments: [{ anchor: { kind: 'symbol', id: `${fileInBox}#f` }, kind: 'change', text: 'Why?' }],
    listed: [],
  },
  { with: 'an answer on it', comments: [answering(`notes:${fileInBox}`)], listed: [] },
  {
    with: 'an edge comment from it, which does not count',
    comments: [
      {
        anchor: { kind: 'edge', id: `${fileInBox} -> ${otherInBox}` },
        kind: 'change',
        text: 'Why?',
      },
    ],
    listed: [fileInBox],
  },
  {
    with: 'an answer on an edge from it, which does not count',
    comments: [answering(`notes:${fileInBox} -> ${otherInBox}`)],
    listed: [fileInBox],
  },
  { with: 'a comment on another part', comments: [onAPart(otherInBox)], listed: [fileInBox] },
] satisfies ReadonlyArray<{
  with: string;
  comments: Review['comments'];
  listed: ReadonlyArray<string>;
}>)('the parts changed since with $with', ({ comments, listed }) => {
  expect(sinceWith({ since: ['web/src/cart/a.ts'], comments })).toMatchObject({
    changedWithoutComment: listed,
  });
});

test('a box changed since with nothing changed inside it counts a comment on a part inside it', () => {
  const since = ['web/src/cart/notes.txt'];

  expect(sinceWith({ since })).toMatchObject({ changedWithoutComment: ['web/box/cart'] });
  expect(sinceWith({ since, comments: [onAPart(otherInBox)] })).toMatchObject({
    changedWithoutComment: [],
  });
});

test.for([
  { part: 'unchanged since, which stays read', read: otherInBox, stillRead: [otherInBox] },
  { part: 'changed since', read: fileInBox, stillRead: [] },
  { part: 'gone since', read: 'web/file/gone.ts', stillRead: [] },
  { part: 'holding one changed since', read: 'web', stillRead: [] },
])('a part read last round and $part', ({ read, stillRead }) => {
  expect(sinceWith({ since: ['web/src/cart/a.ts'], read: [read] })).toMatchObject({ stillRead });
});
