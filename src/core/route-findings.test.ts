import { expect, test } from 'vitest';
import type { RouteRow, RoutesReading } from './read-routes.ts';
import { routeFindings } from './route-findings.ts';
import type { Route } from './routes.ts';

const FILE = 'config/routes.rb';

const route = (overrides: Partial<Route> = {}): Route => ({
  verb: 'GET',
  path: '/users',
  target: 'users#index',
  root: '',
  file: FILE,
  line: 3,
  ...overrides,
});

const removed = (overrides: Partial<Route> = {}, patch = FILE): RouteRow => ({
  state: 'removed',
  base: route(overrides),
  patch,
});

const changed = (overrides: Partial<Route> = {}, patch = FILE): RouteRow => ({
  state: 'changed',
  base: route(overrides),
  head: route({ ...overrides, target: 'people#index' }),
  patch,
});

const reading = (...routes: ReadonlyArray<RouteRow>): ReadonlyArray<RoutesReading> => [
  { routes, unread: [] },
];

test('a removed route needs a look, opening the patch that explains it', () => {
  expect(routeFindings(reading(removed({}, 'config/routes/admin.rb')))).toStrictEqual([
    {
      id: 'routes:removed::GET /users',
      dimension: 'routes',
      level: 'look',
      file: 'config/routes/admin.rb',
      title: 'GET /users removed',
      detail: `Was users#index, at ${FILE}:3.`,
    },
  ]);
});

test('a new target at the same path needs a look', () => {
  expect(routeFindings(reading(changed()))).toStrictEqual([
    {
      id: 'routes:changed::GET /users',
      dimension: 'routes',
      level: 'look',
      file: FILE,
      title: 'GET /users now goes to people#index',
      detail: `Was users#index, at ${FILE}:3.`,
    },
  ]);
});

test('two apps removing one path raise one finding each', () => {
  const ids = routeFindings(
    reading(removed({ root: 'apps/a/' }), removed({ root: 'apps/b/' })),
  ).map(({ id }) => id);

  expect(ids).toStrictEqual([
    'routes:removed:apps/a/:GET /users',
    'routes:removed:apps/b/:GET /users',
  ]);
});

const titles = (...routes: ReadonlyArray<RouteRow>) =>
  routeFindings(reading(...routes)).map(({ title }) => title);

test('the PATCH and PUT of an update read as one line, either way round', () => {
  const update = { path: '/users/:id', target: 'users#update' };

  expect(
    titles(removed({ ...update, verb: 'PATCH' }), removed({ ...update, verb: 'PUT' })),
  ).toStrictEqual(['PATCH/PUT /users/:id removed']);
  expect(
    titles(removed({ ...update, verb: 'PUT' }), removed({ ...update, verb: 'PATCH' })),
  ).toStrictEqual(['PATCH/PUT /users/:id removed']);
});

test('a PATCH or PUT alone reads as itself', () => {
  expect(titles(removed({ verb: 'PUT' }))).toStrictEqual(['PUT /users removed']);
  expect(titles(removed({ verb: 'PATCH' }))).toStrictEqual(['PATCH /users removed']);
});

test.for([
  { what: 'paths', other: { verb: 'PUT', path: '/people' } },
  { what: 'targets', other: { verb: 'PUT', target: 'people#index' } },
  { what: 'apps', other: { verb: 'PUT', root: 'apps/a/' } },
])('a PATCH and a PUT of different $what stay two lines', ({ other }) => {
  expect(routeFindings(reading(removed({ verb: 'PATCH' }), removed(other)))).toHaveLength(2);
});

test('a PATCH removed and its PUT changed stay two lines', () => {
  expect(routeFindings(reading(removed({ verb: 'PATCH' }), changed({ verb: 'PUT' })))).toHaveLength(
    2,
  );
});

test('a PATCH and a PUT moved to different new targets stay two lines', () => {
  const put: RouteRow = {
    state: 'changed',
    base: route({ verb: 'PUT' }),
    head: route({ verb: 'PUT', target: 'teams#index' }),
    patch: FILE,
  };

  expect(routeFindings(reading(changed({ verb: 'PATCH' }), put))).toHaveLength(2);
});

test('a PATCH and a PUT moved from different targets to one stay two lines', () => {
  const put: RouteRow = {
    state: 'changed',
    base: route({ verb: 'PUT', target: 'teams#index' }),
    head: route({ verb: 'PUT', target: 'people#index' }),
    patch: FILE,
  };

  expect(routeFindings(reading(changed({ verb: 'PATCH' }), put))).toHaveLength(2);
});

test('a PUT removed as its PATCH is added still reads as removed', () => {
  const added: RouteRow = { state: 'added', head: route({ verb: 'PATCH' }), patch: FILE };

  expect(titles(added, removed({ verb: 'PUT' }))).toStrictEqual(['PUT /users removed']);
});
