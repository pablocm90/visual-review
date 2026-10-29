// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import type { GraphNode } from './graph.ts';
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

  expect(pageData({ reading, range: 'main..feature' })).toStrictEqual({
    range: 'main..feature',
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
    pageData({ reading: readingWith({ skipped }), range: 'abc..def', pullRequest }),
  ).toMatchObject({ range: 'abc..def', pullRequest, skipped });
});

const viewer = readFileSync(join(import.meta.dirname, '..', 'viewer', 'viewer.html'), 'utf8');

const slotsOf = (html: string) => {
  const document = new DOMParser().parseFromString(html, 'text/html');
  return (id: string) => document.getElementById(id)?.textContent ?? undefined;
};

test('the page holds its data whole, a range that closes a script tag included, and no notes until they are filled', () => {
  const data = pageData({ reading: readingWith({}), range: 'main..x</script><b>' });

  expect(pageIn(slotsOf(pageHtml({ viewer, data })))).toStrictEqual({ data, notes: undefined });
});

test('notes filled into a page come back whole, a note that closes a script tag included, beside its data', () => {
  const data = pageData({ reading: readingWith({}), range: 'main..feature' });
  const notes = {
    version: 1 as const,
    summary: [],
    tests: '',
    notes: { 'web/file/a.ts': { text: 'Ends a script: </script>' } },
  };

  const page = notedPageHtml({ page: pageHtml({ viewer, data }), notes });

  expect(pageIn(slotsOf(page))).toStrictEqual({ data, notes });
});
