import { expect, test } from 'vitest';
import type { RouteRow, RoutesReading, UnreadRow } from './read-routes.ts';
import { routeFindings } from './route-findings.ts';
import type { Route, UnreadRoute } from './routes.ts';

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
      check: 'routes:removed',
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
      check: 'routes:changed',
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
  const patch: RouteRow = { state: 'added', head: route({ verb: 'PATCH' }), patch: FILE };

  expect(titles(patch, removed({ verb: 'PUT' }))).toStrictEqual([
    'PUT /users removed',
    `1 route added in ${FILE}`,
  ]);
});

const added = (overrides: Partial<Route> = {}, patch = FILE): RouteRow => ({
  state: 'added',
  head: route(overrides),
  patch,
});

test('added routes are one finding for information per file, with the count', () => {
  const admin = 'config/routes/admin.rb';

  expect(
    routeFindings(
      reading(added({ path: '/a' }), added({ path: '/b' }, admin), added({ path: '/c' })),
    ),
  ).toStrictEqual([
    {
      id: `routes:added:${FILE}`,
      check: 'routes:added',
      dimension: 'routes',
      level: 'info',
      file: FILE,
      title: `2 routes added in ${FILE}`,
    },
    {
      id: `routes:added:${admin}`,
      check: 'routes:added',
      dimension: 'routes',
      level: 'info',
      file: admin,
      title: `1 route added in ${admin}`,
    },
  ]);
});

test('an added PATCH and PUT count as one route', () => {
  expect(titles(added({ verb: 'PATCH' }), added({ verb: 'PUT' }))).toStrictEqual([
    `1 route added in ${FILE}`,
  ]);
});

const item = (overrides: Partial<UnreadRoute> = {}): UnreadRoute => ({
  text: 'devise_for :users',
  path: '',
  module: '',
  root: '',
  file: FILE,
  line: 5,
  ...overrides,
});

const unreadReading = (...unread: ReadonlyArray<UnreadRow>): ReadonlyArray<RoutesReading> => [
  { routes: [], unread },
];

test('what cannot be read needs a look, saying whether it came or went', () => {
  const unreadFile = 'config/routes/admin.rb';

  expect(
    routeFindings(
      unreadReading(
        { state: 'added', item: item({ file: unreadFile }), patch: FILE },
        { state: 'removed', item: item({ text: 'concern :a' }), patch: FILE },
      ),
    ),
  ).toStrictEqual([
    {
      id: `routes:not-read:${unreadFile}:devise_for :users`,
      check: 'routes:not-read',
      dimension: 'routes',
      level: 'look',
      file: FILE,
      title: 'Added, not read: devise_for :users',
      detail: `devise_for :users, at ${unreadFile}:5. Routes it draws aren't compared.`,
    },
    {
      id: `routes:not-read:${FILE}:concern :a`,
      check: 'routes:not-read',
      dimension: 'routes',
      level: 'look',
      file: FILE,
      title: 'Removed, not read: concern :a',
      detail: `concern :a, at ${FILE}:5. Routes it draws aren't compared.`,
    },
  ]);
});

test('a long text is shortened in the title and whole in the detail', () => {
  const text = `if ${'a'.repeat(100)}`;

  const [finding] = routeFindings(
    unreadReading({ state: 'added', item: item({ text }), patch: FILE }),
  );

  expect(finding?.title).toBe(`Added, not read: ${text.slice(0, 60)}…`);
  expect(finding?.detail).toContain(text);
});

test('a text of the longest shown length is not shortened', () => {
  const text = 'a'.repeat(60);

  const [finding] = routeFindings(
    unreadReading({ state: 'added', item: item({ text }), patch: FILE }),
  );

  expect(finding?.title).toBe(`Added, not read: ${text}`);
});

test('the same text twice in a file keeps two ids', () => {
  const ids = routeFindings(
    unreadReading(
      { state: 'added', item: item(), patch: FILE },
      { state: 'added', item: item(), patch: FILE },
      { state: 'added', item: item({ file: 'config/routes/admin.rb' }), patch: FILE },
      { state: 'added', item: item({ text: 'concern :a' }), patch: FILE },
    ),
  ).map(({ id }) => id);

  expect(ids).toStrictEqual([
    `routes:not-read:${FILE}:devise_for :users`,
    `routes:not-read:${FILE}:devise_for :users#2`,
    'routes:not-read:config/routes/admin.rb:devise_for :users',
    `routes:not-read:${FILE}:concern :a`,
  ]);
});

test('route files that could not be read are one finding that needs a look', () => {
  expect(routeFindings([{ file: FILE, notRead: 'Ruby syntax error' }])).toStrictEqual([
    {
      id: `routes:not-read:${FILE}`,
      check: 'routes:not-read',
      dimension: 'routes',
      level: 'look',
      file: FILE,
      title: `${FILE} not read: Ruby syntax error`,
    },
  ]);
});
