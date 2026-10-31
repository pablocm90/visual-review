// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import type { GraphNode } from './graph.ts';
import type { ReviewNotes } from './notes.ts';
import { notedPageHtml, pageData, pageHtml, pageIn } from './page.ts';
import type { RangeReading } from './read-range.ts';

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
  tests: [],
  danglingCalls: [],
  skipped: [],
  thresholds: { cyclomatic: 10, hotspot: { churn: 6, cyclomatic: 8 } },
  ...overrides,
});

test("a reading's page data holds its diff, its dangling calls and test files, the patches of drawn files apart from the rest, and an empty list of skipped stacks", () => {
  const tests = [{ path: 'web/a.test.ts', unreadable: 'SyntaxError' }];
  const reading = readingWith({
    patches: [patch('web/src/a.ts'), patch('README.md')],
    danglingCalls: [{ from: 'web/file/a.ts', path: '/api/x' }],
    tests,
  });

  expect(
    pageData({ repo: 'shop', reading, range: 'main..feature', version: '1.2.3' }),
  ).toStrictEqual({
    repo: 'shop',
    range: 'main..feature',
    version: '1.2.3',
    diff: {
      nodes: [
        { ...webStack, state: 'unchanged' },
        { ...webFile('a.ts'), state: 'added' },
      ],
      edges: [],
    },
    metrics: {},
    metricFindings: [],
    dangling: [{ from: 'web/file/a.ts', path: '/api/x' }],
    patches: [patch('web/src/a.ts')],
    undrawn: [patch('README.md')],
    tests,
    skipped: [],
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
      pullRequest,
    }),
  ).toMatchObject({ range: 'abc..def', pullRequest, skipped });
});

const version = '1.2.3';

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

test('the page holds its data whole, a range that closes a script tag included, and no notes until they are filled', () => {
  const data = pageData({
    repo: 'shop',
    reading: readingWith({}),
    range: 'main..x</script><b>',
    version,
  });

  expect(pageIn(slotsOf(pageHtml({ viewer, data })))).toStrictEqual({ data, notes: undefined });
});

test('notes filled into a page come back whole, a note holding replacement patterns such as $& included, beside its data', () => {
  const data = pageData({
    repo: 'shop',
    reading: readingWith({}),
    range: 'main..feature',
    version,
  });
  const notes = notesWith({ 'web/file/a.ts': { text: "Costs $& more, and $' too." } });

  const page = notedPageHtml({ page: pageHtml({ viewer, data }), notes, notesFile, version });

  expect(pageIn(slotsOf(page))).toStrictEqual({ data, notes });
});

const pageFor = (pageVersion: string) =>
  pageHtml({
    viewer,
    data: pageData({
      repo: 'shop',
      reading: readingWith({}),
      range: 'main..feature',
      version: pageVersion,
    }),
  });

test('notes for a page another visual-review wrote are refused, naming its version', () => {
  expect(() =>
    notedPageHtml({ page: pageFor('1.0.0'), notes: notesWith({}), notesFile, version }),
  ).toThrow(
    'The page for main..feature was written by visual-review 1.0.0: run visual-review without --notes first',
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
    pageData({ repo: 'shop', reading, range: 'main..feature', version }).metrics['web/file/a.ts'],
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
    pageData({ repo: 'shop', reading, range: 'main..feature', version }).metrics['web/file/a.ts'],
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
    pageData({ repo: 'shop', reading, range: 'main..feature', version }).metrics['web/file/a.ts'],
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
    pageData({ repo: 'shop', reading, range: 'main..feature', version }).metrics['web/file/a.ts'],
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
    pageData({ repo: 'shop', reading, range: 'main..feature', version }).metrics['web/file/a.ts'],
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

  const { metrics } = pageData({ repo: 'shop', reading, range: 'main..feature', version });

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
    pageData({ repo: 'shop', reading, range: 'main..feature', version }).metrics['web/file/a.ts'],
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
    pageData({ repo: 'shop', reading, range: 'main..feature', version }).metrics['web/file/a.ts'],
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

  const { metrics } = pageData({ repo: 'shop', reading, range: 'main..feature', version });

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
    pageData({ repo: 'shop', reading, range: 'main..feature', version }).metrics['web/box/m'],
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
      thresholds: { cyclomatic: 4, hotspot: { churn: 6, cyclomatic: 8 } },
    });

    expect(
      pageData({ repo: 'shop', reading, range: 'main..feature', version }).metricFindings,
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
  const reading = readingOfA({ base, head, thresholds: { cyclomatic: 20, hotspot: threshold } });

  expect(
    pageData({ repo: 'shop', reading, range: 'main..feature', version }).metricFindings,
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
    thresholds: { cyclomatic: 10, hotspot: { churn: 6, cyclomatic: 8 }, ...thresholds },
  });

  expect(
    pageData({ repo: 'shop', reading, range: 'main..feature', version }).metricFindings,
  ).toStrictEqual(findings.map(finding => ({ node: 'web/file/a.ts', ...finding })));
});
