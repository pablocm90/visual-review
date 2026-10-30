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

const webStack: GraphNode = { id: 'web', kind: 'stack', label: 'web', path: '' };

const patch = (path: string) => ({ path, patch: `diff --git a/${path} b/${path}` });

const readingWith = (overrides: Partial<RangeReading>): RangeReading => ({
  before: { nodes: [webStack], edges: [] },
  after: { nodes: [webStack, webFile('a.ts')], edges: [] },
  churn: { before: {}, after: {} },
  changedPaths: ['web/src/a.ts'],
  renames: [],
  patches: [],
  tests: [],
  danglingCalls: [],
  skipped: [],
  ...overrides,
});

test("a reading's page data holds its diff, its dangling calls and test files, the patches of drawn files apart from the rest, and an empty list of skipped stacks", () => {
  const tests = [{ path: 'web/a.test.ts', unreadable: 'SyntaxError' }];
  const reading = readingWith({
    patches: [patch('web/src/a.ts'), patch('README.md')],
    danglingCalls: [{ from: 'web/file/a.ts', path: '/api/x' }],
    tests,
  });

  expect(pageData({ reading, range: 'main..feature', version: '1.2.3' })).toStrictEqual({
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
    pageData({ reading: readingWith({ skipped }), range: 'abc..def', version, pullRequest }),
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
  const data = pageData({ reading: readingWith({}), range: 'main..x</script><b>', version });

  expect(pageIn(slotsOf(pageHtml({ viewer, data })))).toStrictEqual({ data, notes: undefined });
});

test('notes filled into a page come back whole, a note holding replacement patterns such as $& included, beside its data', () => {
  const data = pageData({ reading: readingWith({}), range: 'main..feature', version });
  const notes = notesWith({ 'web/file/a.ts': { text: "Costs $& more, and $' too." } });

  const page = notedPageHtml({ page: pageHtml({ viewer, data }), notes, notesFile, version });

  expect(pageIn(slotsOf(page))).toStrictEqual({ data, notes });
});

const pageFor = (pageVersion: string) =>
  pageHtml({
    viewer,
    data: pageData({ reading: readingWith({}), range: 'main..feature', version: pageVersion }),
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

  expect(pageData({ reading, range: 'main..feature', version }).metrics['web/file/a.ts']).toEqual({
    base: { churn: 3 },
    head: { churn: 4 },
  });
});

test.for([
  {
    reason: 'an added file gets churn on the head side only',
    before: [webStack],
    after: [webStack, webFile('a.ts')],
    churn: { before: {}, after: { 'web/src/a.ts': 2 } },
    metrics: { head: { churn: 2 } },
  },
  {
    reason: 'a removed file gets churn on the base side only',
    before: [webStack, webFile('a.ts')],
    after: [webStack],
    churn: { before: { 'web/src/a.ts': 2 }, after: {} },
    metrics: { base: { churn: 2 } },
  },
])('$reason', ({ before, after, churn, metrics }) => {
  const reading = readingWith({
    before: { nodes: before, edges: [] },
    after: { nodes: after, edges: [] },
    churn,
  });

  expect(
    pageData({ reading, range: 'main..feature', version }).metrics['web/file/a.ts'],
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

  const { metrics } = pageData({ reading, range: 'main..feature', version });

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

  expect(pageData({ reading, range: 'main..feature', version }).metrics['web/file/a.ts']).toEqual({
    base: { churn: 5 },
    head: { churn: 1 },
  });
});

test('a box gets, on each side, the highest churn among the measured nodes inside it at any depth, marked as such, with nothing on a side where none inside is measured, and nothing for a box with none measured inside', () => {
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

  const { metrics } = pageData({ reading, range: 'main..feature', version });

  expect(metrics).toStrictEqual({
    web: { highestInside: true, base: { churn: 1 }, head: { churn: 5 } },
    'web/box/m': { highestInside: true, head: { churn: 5 } },
    'web/file/m/a.ts': { head: { churn: 5 } },
    'web/file/b.ts': { base: { churn: 1 }, head: { churn: 4 } },
  });
});
