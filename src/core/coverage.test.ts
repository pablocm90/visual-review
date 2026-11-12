import { expect, test } from 'vitest';
import { type CoverageFacts, coverageOf } from './coverage.ts';
import type { Dimension } from './findings.ts';

const facts = (overrides: Partial<CoverageFacts> = {}): CoverageFacts => ({
  skipped: [],
  symbolsNotRead: [],
  measuresNotRead: [],
  symbols: [],
  tests: [],
  dependencyChanges: [],
  schemas: [],
  migrations: [],
  readers: ['rails'],
  linksNotRead: [],
  routes: [],
  reachesNotRead: [],
  rulesNotRead: [],
  access: [],
  openActions: [],
  patches: [],
  deployConfig: { flags: ['Flipper.enabled?'] },
  ...overrides,
});

const notReadIn = (dimension: Dimension, overrides: Partial<CoverageFacts>) =>
  coverageOf(facts(overrides)).find(entry => entry.dimension === dimension)?.notRead;

test('with nothing unread, each dimension a check raises is listed as checked, and no other', () => {
  expect(coverageOf(facts())).toEqual([
    { dimension: 'structure', notRead: [] },
    { dimension: 'logic', notRead: [] },
    { dimension: 'api', notRead: [] },
    { dimension: 'tests', notRead: [] },
    { dimension: 'metrics', notRead: [] },
    { dimension: 'dependencies', notRead: [] },
    { dimension: 'rules', notRead: [] },
    { dimension: 'schema', notRead: [] },
    { dimension: 'routes', notRead: [] },
    { dimension: 'blast-radius', notRead: [] },
    { dimension: 'cohesion', notRead: [] },
    { dimension: 'security', notRead: [] },
    { dimension: 'deploy', notRead: [] },
  ]);
});

test("blast radius names what its reading couldn't, unless no stack was drawn", () => {
  const reachesNotRead = ['not read: web/src/broken.ts'];

  expect(notReadIn('blast-radius', { reachesNotRead })).toEqual(reachesNotRead);
  expect(notReadIn('blast-radius', { reachesNotRead, readers: [] })).toEqual(['no stack drawn']);
});

test('deploy names each line reading an env key through a variable', () => {
  const patch = [
    '--- a/config/stripe.rb',
    '+++ b/config/stripe.rb',
    '@@ -1,0 +1,1 @@',
    '+Stripe.api_key = ENV[name]',
  ].join('\n');

  expect(notReadIn('deploy', { patches: [{ path: 'config/stripe.rb', patch }] })).toEqual([
    'config/stripe.rb:1 reads an env key through a variable',
  ]);
});

const flipperPatch = (line: string) => ({
  path: 'app/a.rb',
  patch: ['@@ -1,1 +1,1 @@', `-${line}`, '+nothing'].join('\n'),
});

test.for([
  { reason: 'none configured', deployConfig: {}, patches: [], notRead: ['flags: Flipper only'] },
  {
    reason: 'none configured and a Flipper call seen',
    deployConfig: {},
    patches: [flipperPatch('Flipper.enabled?(:x)')],
    notRead: [],
  },
  { reason: 'flags configured', deployConfig: { flags: [] }, patches: [], notRead: [] },
])('deploy with $reason reads flags as $notRead', ({ deployConfig, patches, notRead }) => {
  expect(notReadIn('deploy', { deployConfig, patches })).toEqual(notRead);
});

const DUMP = { file: 'db/schema.rb', tables: [] };

const MIGRATION = { file: 'db/migrate/20261112_drop_handle.rb', risks: [] };

test.for([
  {
    reason: 'no Rails stack',
    readers: ['rust'],
    schemas: [],
    migrations: [],
    notRead: ['columns: Rails only'],
  },
  {
    reason: 'no Rails stack and a dump changed',
    readers: ['rust'],
    schemas: [DUMP],
    migrations: [],
    notRead: [],
  },
  {
    reason: 'a migration added and no dump changed',
    readers: ['rust'],
    schemas: [],
    migrations: [MIGRATION],
    notRead: ['columns: db/schema.rb only'],
  },
  {
    reason: 'a migration added and its dump changed',
    readers: ['rails'],
    schemas: [DUMP],
    migrations: [MIGRATION],
    notRead: [],
  },
] satisfies ReadonlyArray<
  Pick<CoverageFacts, 'readers' | 'schemas' | 'migrations'> & {
    reason: string;
    notRead: ReadonlyArray<string>;
  }
>)('deploy with $reason reads columns as $notRead', ({ readers, schemas, migrations, notRead }) => {
  expect(notReadIn('deploy', { readers, schemas, migrations })).toEqual(notRead);
});

test("rules names what the config's rules couldn't read", () => {
  const rulesNotRead = ['no-invoices: from shop/class/*Controler matches no node'];

  expect(notReadIn('rules', { rulesNotRead })).toEqual(rulesNotRead);
});

test('structure names a skipped stack, and cohesion stays checked', () => {
  const skipped = [
    { reader: 'rust' as const, stacks: ['api', 'worker'], reason: 'cargo not found on PATH' },
  ];

  expect(notReadIn('structure', { skipped })).toEqual([
    'api, worker not read: cargo not found on PATH',
  ]);
  expect(notReadIn('cohesion', { skipped })).toEqual([]);
});

test.for(['logic', 'api', 'tests', 'blast-radius'] as const)(
  '%s names, once each, the skipped stacks and those whose reader reads no symbols',
  dimension => {
    const skipped = [
      { reader: 'rust' as const, stacks: ['api', 'worker'], reason: 'cargo not found on PATH' },
    ];

    expect(notReadIn(dimension, { skipped, symbolsNotRead: ['worker', 'web'] })).toEqual([
      'not read for api',
      'not read for worker',
      'not read for web',
    ]);
  },
);

test.for(['logic', 'api', 'tests', 'blast-radius'] as const)(
  '%s names a file whose symbols are unreadable',
  dimension => {
    const symbols = [{ stack: 'web', node: 'web/src/broken.ts', unreadable: 'SyntaxError' }];

    expect(notReadIn(dimension, { symbols })).toEqual(['not read for web/src/broken.ts']);
  },
);

test('only tests names a test file it could not read', () => {
  const tests = [{ path: 'web/src/broken.test.ts', stack: 'web', unreadable: 'SyntaxError' }];

  expect(notReadIn('tests', { tests })).toEqual(['not read for web/src/broken.test.ts']);
  expect(notReadIn('logic', { tests })).toEqual([]);
  expect(notReadIn('api', { tests })).toEqual([]);
});

test('dependencies names a lockfile it could not read, and not one it could', () => {
  const dependencyChanges = [
    { lockfile: 'pnpm-lock.yaml', notRead: 'unknown format' },
    { lockfile: 'Cargo.lock', ecosystem: 'cargo', packages: [] },
  ];

  expect(notReadIn('dependencies', { dependencyChanges })).toEqual(['not read: pnpm-lock.yaml']);
});

test('schema names the dump and the migration it could not read, and not those it could', () => {
  const schemas = [
    { file: 'db/schema.rb', notRead: 'parse error' },
    { file: 'db/queue_schema.rb', tables: [] },
  ];
  const migrations = [
    { file: 'db/migrate/1_add.rb', notRead: 'parse error' },
    { file: 'db/migrate/2_add.rb', risks: [] },
  ];

  expect(notReadIn('schema', { schemas, migrations })).toEqual([
    'not read: db/schema.rb',
    'not read: db/migrate/1_add.rb',
  ]);
});

test('metrics names, once each, the skipped stacks and those whose reader measures nothing', () => {
  const skipped = [
    { reader: 'rust' as const, stacks: ['api', 'worker'], reason: 'cargo not found on PATH' },
  ];

  expect(notReadIn('metrics', { skipped, measuresNotRead: ['worker', 'web'] })).toEqual([
    'not read for api',
    'not read for worker',
    'not read for web',
  ]);
});

test.for([
  { reason: 'no Rails stack on either side', overrides: {}, notRead: ['Rails only'] },
  {
    reason: 'a dump read',
    overrides: { schemas: [{ file: 'db/schema.rb', tables: [] }] },
    notRead: [],
  },
  {
    reason: 'a migration read',
    overrides: { migrations: [{ file: 'db/migrate/1_add.rb', risks: [] }] },
    notRead: [],
  },
])('with $reason and no Rails reader, schema reads $notRead', ({ overrides, notRead }) => {
  expect(notReadIn('schema', { readers: ['typescript'], ...overrides })).toEqual(notRead);
});

test.for([
  {
    reason: 'no Rails stack on either side',
    overrides: {},
    notRead: ['authorization and risky calls: Rails only'],
  },
  {
    reason: 'controllers read',
    overrides: { access: [{ base: { actions: [] }, head: { actions: [] } }] },
    notRead: ['risky calls not read for typescript'],
  },
])('with $reason and no Rails reader, security reads $notRead', ({ overrides, notRead }) => {
  expect(notReadIn('security', { readers: ['typescript'], ...overrides })).toEqual(notRead);
});

test.for(['logic', 'api', 'tests', 'metrics'] as const)(
  'with no stack drawn, %s says so rather than reading as checked',
  dimension => {
    expect(notReadIn(dimension, { readers: [] })).toEqual(['no stack drawn']);
  },
);

test("routes gives the linker's reason where nothing else reads routes", () => {
  expect(notReadIn('routes', { readers: ['typescript'], linksNotRead: ['no axum crate'] })).toEqual(
    ['no axum crate'],
  );
});

test.for([
  { readers: ['rails'], routes: [] },
  { readers: ['typescript'], routes: [{ routes: [], unread: [] }] },
] satisfies ReadonlyArray<Pick<CoverageFacts, 'readers' | 'routes'>>)(
  'routes read from Rails need no axum crate, and keep the reasons a linker that could have run gives: %j',
  overrides => {
    expect(notReadIn('routes', { ...overrides, linksNotRead: ['no axum crate'] })).toEqual([]);
    expect(notReadIn('routes', { ...overrides, linksNotRead: ['turned off'] })).toEqual([
      'turned off',
    ]);
  },
);

test('routes names a route file it could not read, and not one it could', () => {
  expect(
    notReadIn('routes', {
      routes: [
        { file: 'config/routes.rb', notRead: 'parse error' },
        { routes: [], unread: [] },
      ],
    }),
  ).toEqual(['not read: config/routes.rb']);
});

const unreadAction = {
  controller: 'UsersController',
  controllerPath: 'users',
  action: 'show',
  root: '',
  file: 'app/controllers/users_controller.rb',
  line: 4,
  unread: [
    { text: 'before_action *GLOBAL', file: 'app/controllers/application_controller.rb', line: 2 },
  ],
};

test('security names each other reader whose stacks it reads no risky calls for, beside Rails', () => {
  expect(notReadIn('security', { readers: ['rails', 'typescript', 'rust'] })).toEqual([
    'risky calls not read for typescript',
    'risky calls not read for rust',
  ]);
});

test('security names each file whose symbols, and so whose risky calls, were not read', () => {
  expect(
    notReadIn('security', {
      symbols: [{ stack: 'shop', node: 'shop/class/User', unreadable: 'too big' }],
    }),
  ).toEqual(['not read for shop/class/User']);
});

test('security names each permit a changed method gained and could not name, by its node and method', () => {
  expect(
    notReadIn('security', {
      symbols: [
        {
          stack: 'shop',
          node: 'shop/class/UsersController',
          symbols: [
            {
              name: 'create',
              scope: 'UsersController',
              kind: 'method',
              lines: { head: { start: 2, end: 4 } },
              exported: { head: true },
              change: 'added',
              risks: [
                { kind: 'permit', text: 'name' },
                { kind: 'permit', text: '*FIELDS', unread: true },
              ],
            },
          ],
          exports: { added: [], removed: [] },
          kind: 'logic',
        },
      ],
    }),
  ).toEqual(['shop/class/UsersController not read: permit(*FIELDS) in UsersController.create']);
});

test('security names, where it is written, what a new action was read through and could not be', () => {
  expect(
    notReadIn('security', {
      access: [{ base: { actions: [] }, head: { actions: [unreadAction] } }],
    }),
  ).toEqual(['app/controllers/application_controller.rb:2 not read: before_action *GLOBAL']);
});

test("security leaves out what an action the config's security.open lists was read through", () => {
  expect(
    notReadIn('security', {
      access: [{ base: { actions: [] }, head: { actions: [unreadAction] } }],
      openActions: ['UsersController#show'],
    }),
  ).toEqual([]);
});

test('security names what an unchanged action was read through when a route the change adds reaches it', () => {
  const route = {
    verb: 'GET',
    path: '/users/:id',
    target: 'users#show',
    root: '',
    file: 'config/routes.rb',
    line: 3,
  };

  expect(
    notReadIn('security', {
      access: [{ base: { actions: [unreadAction] }, head: { actions: [unreadAction] } }],
      routes: [
        { routes: [{ state: 'added', head: route, patch: 'config/routes.rb' }], unread: [] },
      ],
    }),
  ).toHaveLength(1);
});
