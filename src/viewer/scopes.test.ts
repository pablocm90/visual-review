import { expect, test } from 'vitest';
import type { DiffedNode, GraphDiff } from '../core/diff-graphs.ts';
import { pageWith } from '../test-support/page-data.ts';
import { CHANGES_ONLY, EVERYTHING, placeOfFile, scopesOf, viewToShow } from './scopes.ts';

const node = (
  id: string,
  kind: DiffedNode['kind'],
  state: DiffedNode['state'],
  parent?: string,
): DiffedNode => ({
  id,
  kind,
  label: id,
  path: id,
  state,
  ...(parent !== undefined && { parent }),
});

const diff: GraphDiff = {
  nodes: [
    node('web', 'stack', 'unchanged'),
    node('app', 'module', 'modified', 'web'),
    node('app/changed.ts', 'file', 'modified', 'app'),
    node('app/beside.ts', 'file', 'unchanged', 'app'),
    node('lib', 'module', 'unchanged', 'web'),
    node('lib/far.ts', 'file', 'unchanged', 'lib'),
  ],
  edges: [{ from: 'app/changed.ts', to: 'app/beside.ts', state: 'unchanged' }],
};

const scopes = scopesOf(pageWith({ range: 'a..b', diff }));

const going = (id: string, scope = CHANGES_ONLY) =>
  viewToShow({
    diff,
    expanded: new Set(),
    noted: new Set(),
    allEdges: false,
    scopes,
    scope,
    id,
  });

test('going to a changed file in a closed box opens the box and keeps Changes only', () => {
  const { expanded, allEdges, scope } = going('app/changed.ts');
  expect([...expanded]).toStrictEqual(['app']);
  expect(allEdges).toBe(false);
  expect(scope[0]).toBe('Changes only');
});

test('going to an unchanged file widens Show only as far as draws it: one hop of a change, else Everything', () => {
  expect(going('app/beside.ts').scope[0]).toBe('Changed + 1 hop');
  expect(going('lib/far.ts').scope).toBe(EVERYTHING);
  expect([...going('lib/far.ts').expanded]).toStrictEqual(['lib']);
});

test('a wider Show already picked stays when it draws the id', () => {
  expect(going('app/changed.ts', EVERYTHING).scope).toBe(EVERYTHING);
});

test("a file's place: a line goes to its patch row, a schema dump to its card, a route file to its route, else the patch", () => {
  const review = {
    schemas: [{ file: 'db/schema.rb', tables: [] }],
    routes: [{ file: 'config/routes.rb', notRead: 'too big' }],
  };
  expect(placeOfFile(review, 'db/schema.rb', { line: 'db/schema.rb@head:4' })).toStrictEqual({
    to: 'patch',
    line: 'db/schema.rb@head:4',
  });
  expect(placeOfFile(review, 'db/schema.rb', { table: 'users' })).toStrictEqual({
    to: 'schema',
    table: 'users',
  });
  expect(placeOfFile(review, 'config/routes.rb', {})).toStrictEqual({ to: 'routes' });
  expect(placeOfFile(review, 'app/models/user.rb', { table: 'users' })).toStrictEqual({
    to: 'patch',
  });
});
