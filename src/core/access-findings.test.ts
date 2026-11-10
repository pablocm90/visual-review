import { expect, test } from 'vitest';
import type { Action } from './access.ts';
import { accessFindings, accessNotRead } from './access-findings.ts';
import type { AccessReading } from './read-access.ts';
import type { RouteChange } from './route-diff.ts';
import type { Route } from './routes.ts';

const FILE = 'app/controllers/users_controller.rb';

const NODE = {
  id: 'shop/class/UsersController',
  kind: 'file',
  label: 'UsersController',
  path: FILE,
} as const;

const action = (overrides: Partial<Action> = {}): Action => ({
  controller: 'UsersController',
  controllerPath: 'users',
  action: 'show',
  root: '',
  file: FILE,
  line: 4,
  ...overrides,
});

const reading = (base: ReadonlyArray<Action>, head: ReadonlyArray<Action>): AccessReading => ({
  base: { actions: base },
  head: { actions: head },
});

const OTHER = {
  id: 'shop/class/User',
  kind: 'file',
  label: 'User',
  path: 'app/models/user.rb',
} as const;

const findingsOf = (...access: ReadonlyArray<AccessReading>) =>
  accessFindings({ access, routes: [], nodes: [OTHER, NODE], open: [] });

test('a new action nothing authorizes needs a look, on its controller', () => {
  expect(findingsOf(reading([], [action()]))).toStrictEqual([
    {
      id: 'security:unauthorized::UsersController#show',
      check: 'security:unauthorized',
      dimension: 'security',
      level: 'look',
      target: NODE.id,
      title: 'UsersController#show added with no authorization',
      detail: `At ${FILE}:4. No callback, parent or call of its own authorizes it.`,
    },
  ]);
});

test('a new action with a cover raises nothing', () => {
  expect(
    findingsOf(reading([], [action({ cover: { by: 'authorize', conditional: false } })])),
  ).toStrictEqual([]);
});

test('an action in a file no node draws opens the file', () => {
  expect(
    accessFindings({ access: [reading([], [action()])], routes: [], nodes: [], open: [] }).map(
      ({ target, file }) => ({
        target,
        file,
      }),
    ),
  ).toStrictEqual([{ target: undefined, file: FILE }]);
});

test('an action nothing authorized before raises nothing', () => {
  expect(findingsOf(reading([action()], [action()]))).toStrictEqual([]);
});

test('an action the base covered and the head does not needs a look, naming the lost cover', () => {
  expect(
    findingsOf(
      reading([action({ cover: { by: 'authorize_user', conditional: false } })], [action()]),
    ).map(({ id, level, title, detail }) => ({ id, level, title, detail })),
  ).toStrictEqual([
    {
      id: 'security:unauthorized::UsersController#show',
      level: 'look',
      title: 'UsersController#show lost its authorization',
      detail: `At ${FILE}:4. authorize_user covered it before; nothing authorizes it now.`,
    },
  ]);
});

const route = (overrides: Partial<Route> = {}): Route => ({
  verb: 'GET',
  path: '/users/:id',
  target: 'users#show',
  root: '',
  file: 'config/routes.rb',
  line: 3,
  ...overrides,
});

const routedTo = (routes: ReadonlyArray<RouteChange>) =>
  accessFindings({ access: [reading([action()], [action()])], routes, nodes: [NODE], open: [] });

test('a route the change adds to an action nothing authorizes needs a look, naming the route', () => {
  expect(
    routedTo([{ state: 'added', head: route() }]).map(({ id, level, title, detail }) => ({
      id,
      level,
      title,
      detail,
    })),
  ).toStrictEqual([
    {
      id: 'security:unauthorized::UsersController#show',
      level: 'look',
      title: 'UsersController#show newly routed with no authorization',
      detail: `At ${FILE}:4. GET /users/:id at config/routes.rb:3 now reaches it; nothing authorizes it.`,
    },
  ]);
});

test('a route the change points at the action needs a look too', () => {
  expect(
    routedTo([{ state: 'changed', base: route({ target: 'users#edit' }), head: route() }]).map(
      ({ title }) => title,
    ),
  ).toStrictEqual(['UsersController#show newly routed with no authorization']);
});

test.for([
  {
    reason: 'a route in another root',
    change: { state: 'added', head: route({ root: 'apps/admin/' }) },
  },
  {
    reason: 'a route to another action',
    change: { state: 'added', head: route({ target: 'users#edit' }) },
  },
  { reason: 'a removed route', change: { state: 'removed', base: route() } },
] satisfies ReadonlyArray<{ reason: string; change: RouteChange }>)(
  '$reason raises nothing',
  ({ change }) => {
    expect(routedTo([change])).toStrictEqual([]);
  },
);

const conditionally = { cover: { by: 'authorize_user', conditional: true } } as const;

test('a new action covered only under an if: or unless: is for information, saying so', () => {
  expect(
    findingsOf(reading([], [action(conditionally)])).map(({ level, title, detail }) => ({
      level,
      title,
      detail,
    })),
  ).toStrictEqual([
    {
      level: 'info',
      title: 'UsersController#show added, authorized only conditionally',
      detail: `At ${FILE}:4. authorize_user covers it only under its if: or unless:.`,
    },
  ]);
});

test('an action covered conditionally on both sides raises nothing', () => {
  expect(findingsOf(reading([action(conditionally)], [action(conditionally)]))).toStrictEqual([]);
});

test('an action the base always covered and the head only conditionally is for information', () => {
  expect(
    findingsOf(
      reading(
        [action({ cover: { by: 'authorize', conditional: false } })],
        [action(conditionally)],
      ),
    ).map(({ level, title, detail }) => ({ level, title, detail })),
  ).toStrictEqual([
    {
      level: 'info',
      title: 'UsersController#show now authorized only conditionally',
      detail: `At ${FILE}:4. authorize covered it always before; authorize_user covers it only under its if: or unless: now.`,
    },
  ]);
});

test('an action nothing authorized before that gains a conditional cover raises nothing', () => {
  expect(findingsOf(reading([action()], [action(conditionally)]))).toStrictEqual([]);
});

test('a route the change adds to an action covered only conditionally is for information', () => {
  expect(
    accessFindings({
      access: [reading([action(conditionally)], [action(conditionally)])],
      routes: [{ state: 'added', head: route() }],
      nodes: [NODE],
      open: [],
    }).map(({ level, title, detail }) => ({ level, title, detail })),
  ).toStrictEqual([
    {
      level: 'info',
      title: 'UsersController#show newly routed, authorized only conditionally',
      detail: `At ${FILE}:4. GET /users/:id at config/routes.rb:3 now reaches it; authorize_user covers it only under its if: or unless:.`,
    },
  ]);
});

test.for([
  { reason: 'by its name', open: 'UsersController#show' },
  { reason: 'by a glob', open: 'Users*#*' },
])('an action listed open, $reason, raises nothing', ({ open }) => {
  expect(
    accessFindings({ access: [reading([], [action()])], routes: [], nodes: [NODE], open: [open] }),
  ).toStrictEqual([]);
});

const UNREAD = {
  text: 'before_action *GLOBAL',
  file: 'app/controllers/application_controller.rb',
  line: 2,
};

const ALWAYS = { by: 'authorize', conditional: false };

test.for([
  { reason: 'new and covered', base: [], cover: ALWAYS, listed: true },
  { reason: 'new and uncovered', base: [], cover: undefined, listed: true },
  {
    reason: 'unchanged and covered',
    base: [action({ cover: ALWAYS })],
    cover: ALWAYS,
    listed: false,
  },
  { reason: 'unchanged and uncovered', base: [action()], cover: undefined, listed: false },
  { reason: 'covered anew', base: [action()], cover: ALWAYS, listed: true },
  {
    reason: 'covered by another name',
    base: [action({ cover: { by: 'authorize_user', conditional: false } })],
    cover: ALWAYS,
    listed: true,
  },
  {
    reason: 'covered only conditionally now',
    base: [action({ cover: ALWAYS })],
    cover: { by: 'authorize', conditional: true },
    listed: true,
  },
])('an action $reason lists its unread rows: $listed', ({ base, cover, listed }) => {
  const head = action({ ...(cover === undefined ? {} : { cover }), unread: [UNREAD] });

  expect(accessNotRead({ access: [reading(base, [head])], routes: [], open: [] }).length > 0).toBe(
    listed,
  );
});

test('an unchanged action a route the change adds reaches lists its unread rows, and one a route left is not', () => {
  const unread = (routes: ReadonlyArray<RouteChange>) =>
    accessNotRead({
      access: [reading([action()], [action({ unread: [UNREAD] })])],
      routes,
      open: [],
    });

  expect(unread([{ state: 'added', head: route() }])).toHaveLength(1);
  expect(unread([{ state: 'removed', base: route() }])).toHaveLength(0);
});

test('a new action listed open lists no unread rows', () => {
  const unread = (open: ReadonlyArray<string>) =>
    accessNotRead({ access: [reading([], [action({ unread: [UNREAD] })])], routes: [], open });

  expect(unread(['UsersController#*'])).toHaveLength(0);
  expect(unread(['UsersController#edit'])).toHaveLength(1);
});

test('a row two actions were read through is listed once', () => {
  expect(
    accessNotRead({
      access: [
        reading([], [action({ unread: [UNREAD] }), action({ action: 'edit', unread: [UNREAD] })]),
      ],
      routes: [],
      open: [],
    }),
  ).toStrictEqual(['app/controllers/application_controller.rb:2 not read: before_action *GLOBAL']);
});
