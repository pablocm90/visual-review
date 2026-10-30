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
