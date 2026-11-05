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
    { dimension: 'schema', notRead: [] },
    { dimension: 'routes', notRead: [] },
    { dimension: 'cohesion', notRead: [] },
  ]);
});

test('structure names a skipped stack, and cohesion stays checked', () => {
  const skipped = [{ reader: 'rust' as const, tool: 'cargo', stacks: ['api', 'worker'] }];

  expect(notReadIn('structure', { skipped })).toEqual([
    'api, worker not read: cargo not found on PATH',
  ]);
  expect(notReadIn('cohesion', { skipped })).toEqual([]);
});

test.for(['logic', 'api', 'tests'] as const)(
  '%s names, once each, the skipped stacks and those whose reader reads no symbols',
  dimension => {
    const skipped = [{ reader: 'rust' as const, tool: 'cargo', stacks: ['api', 'worker'] }];

    expect(notReadIn(dimension, { skipped, symbolsNotRead: ['worker', 'web'] })).toEqual([
      'not read for api',
      'not read for worker',
      'not read for web',
    ]);
  },
);

test.for(['logic', 'api', 'tests'] as const)(
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
  const skipped = [{ reader: 'rust' as const, tool: 'cargo', stacks: ['api', 'worker'] }];

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

test.for(['logic', 'api', 'tests', 'metrics'] as const)(
  'with no stack drawn, %s says so rather than reading as checked',
  dimension => {
    expect(notReadIn(dimension, { readers: [] })).toEqual(['no stack drawn']);
  },
);

test("routes gives the linker's reason", () => {
  expect(notReadIn('routes', { linksNotRead: ['no axum crate'] })).toEqual(['no axum crate']);
});
