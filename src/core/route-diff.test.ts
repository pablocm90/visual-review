import { expect, test } from 'vitest';
import { diffRoutes } from './route-diff.ts';
import type { Route, RouteTable, UnreadRoute } from './routes.ts';

const aRoute = (overrides: Partial<Route> = {}): Route => ({
  verb: 'GET',
  path: '/users',
  target: 'users#index',
  root: '',
  file: 'config/routes.rb',
  line: 2,
  ...overrides,
});

const anUnread = (overrides: Partial<UnreadRoute> = {}): UnreadRoute => ({
  text: 'devise_for :users',
  path: '',
  module: '',
  root: '',
  file: 'config/routes.rb',
  line: 3,
  ...overrides,
});

const table = (overrides: Partial<RouteTable> = {}): RouteTable => ({
  routes: [],
  unread: [],
  ...overrides,
});

const diffOfRoutes = (base: ReadonlyArray<Route>, head: ReadonlyArray<Route>) =>
  diffRoutes({ base: table({ routes: base }), head: table({ routes: head }) }).routes;

const diffOfUnread = (base: ReadonlyArray<UnreadRoute>, head: ReadonlyArray<UnreadRoute>) =>
  diffRoutes({ base: table({ unread: base }), head: table({ unread: head }) }).unread;

test('a route only the head has is added, one only the base has removed', () => {
  const kept = aRoute();
  const gone = aRoute({ path: '/gone' });
  const fresh = aRoute({ path: '/fresh' });
  expect(diffOfRoutes([kept, gone], [kept, fresh])).toStrictEqual([
    { state: 'added', head: fresh },
    { state: 'removed', base: gone },
  ]);
});

test('changes keep the order the routes are drawn in', () => {
  const first = aRoute({ path: '/first' });
  const second = aRoute({ path: '/second' });
  expect(diffOfRoutes([], [first, second])).toStrictEqual([
    { state: 'added', head: first },
    { state: 'added', head: second },
  ]);
  expect(diffOfRoutes([first, second], [])).toStrictEqual([
    { state: 'removed', base: first },
    { state: 'removed', base: second },
  ]);
});

test('a new target at the same verb and path is one changed route', () => {
  const base = aRoute();
  const head = aRoute({ target: 'people#index' });
  expect(diffOfRoutes([base], [head])).toStrictEqual([{ state: 'changed', base, head }]);
});

test.for([
  { moved: 'a line', overrides: { line: 40 } },
  { moved: 'a file', overrides: { file: 'config/routes/users.rb' } },
])('a route moved to another $moved is no change', ({ overrides }) => {
  expect(diffOfRoutes([aRoute()], [aRoute(overrides)])).toStrictEqual([]);
});

test.for([
  { differs: 'verb', other: { verb: 'POST' } },
  { differs: 'app', other: { root: 'apps/shop/', file: 'apps/shop/config/routes.rb' } },
])('a route of another $differs is another route', ({ other }) => {
  const route = aRoute();
  const elsewhere = aRoute(other);
  expect(diffOfRoutes([route], [route, elsewhere])).toStrictEqual([
    { state: 'added', head: elsewhere },
  ]);
});

test('of two routes at one verb and path the first is the one Rails answers with', () => {
  const answering = aRoute({ target: 'a#first' });
  const shadowed = aRoute({ target: 'b#second' });
  expect(diffOfRoutes([answering, shadowed], [answering])).toStrictEqual([]);
  expect(diffOfRoutes([answering, shadowed], [shadowed])).toStrictEqual([
    { state: 'changed', base: answering, head: shadowed },
  ]);
});

test('an item not read is compared by its text, wherever it moves', () => {
  expect(diffOfUnread([anUnread()], [anUnread({ line: 9, file: 'b.rb' })])).toStrictEqual([]);
});

test('an item not read that came or went says so', () => {
  const gone = anUnread({ text: 'if a then b end' });
  const fresh = anUnread({ text: 'devise_for :admins' });
  expect(diffOfUnread([gone], [fresh])).toStrictEqual([
    { state: 'added', item: fresh },
    { state: 'removed', item: gone },
  ]);
});

test.for([
  { under: 'path', other: { path: '/api' } },
  { under: 'module', other: { module: 'api/' } },
  { under: 'app', other: { root: 'apps/shop/' } },
])('an item not read under another $under is another item', ({ other }) => {
  const moved = anUnread(other);
  expect(diffOfUnread([anUnread()], [moved])).toStrictEqual([
    { state: 'added', item: moved },
    { state: 'removed', item: anUnread() },
  ]);
});

test('a second copy of an item not read counts, added or removed', () => {
  const copy = anUnread({ line: 8 });
  expect(diffOfUnread([anUnread()], [anUnread(), copy])).toStrictEqual([
    { state: 'added', item: copy },
  ]);
  expect(diffOfUnread([anUnread(), copy], [anUnread()])).toStrictEqual([
    { state: 'removed', item: copy },
  ]);
});
