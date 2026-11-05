import { expect, test } from 'vitest';
import type { SchemaColumn, SchemaIndex, SchemaTable } from './schema.ts';
import { diffTables } from './schema-diff.ts';

const column = (overrides?: Partial<SchemaColumn>): SchemaColumn => ({
  name: 'email',
  type: 'string',
  options: 'null: false',
  ...overrides,
});

const index = (overrides?: Partial<SchemaIndex>): SchemaIndex => ({
  name: 'index_users_on_email',
  columns: ['email'],
  options: 'unique: true',
  ...overrides,
});

const table = (overrides?: Partial<SchemaTable>): SchemaTable => ({
  name: 'users',
  options: 'force: :cascade',
  columns: [column()],
  indexes: [index()],
  ...overrides,
});

test('a table on both sides as it was is no change, whatever its column order', () => {
  const name = column({ name: 'name' });

  expect(
    diffTables({
      base: [table({ columns: [column(), name] })],
      head: [table({ columns: [name, column()] })],
    }),
  ).toStrictEqual([]);
});

test('an added table lists all it holds as added', () => {
  expect(diffTables({ base: [], head: [table()] })).toStrictEqual([
    {
      name: 'users',
      state: 'added',
      options: { base: '', head: 'force: :cascade' },
      columns: [{ state: 'added', head: column() }],
      indexes: [{ state: 'added', head: index() }],
    },
  ]);
});

test('a removed table lists all it held as removed', () => {
  expect(diffTables({ base: [table()], head: [] })).toStrictEqual([
    {
      name: 'users',
      state: 'removed',
      options: { base: 'force: :cascade', head: '' },
      columns: [{ state: 'removed', base: column() }],
      indexes: [{ state: 'removed', base: index() }],
    },
  ]);
});

test('a changed table lists only what changed, each column paired by name', () => {
  const kept = column({ name: 'kept' });
  const retyped = {
    base: column({ name: 'age', type: 'integer' }),
    head: column({ name: 'age', type: 'bigint' }),
  };
  const limited = {
    base: column({ name: 'bio' }),
    head: column({ name: 'bio', options: 'limit: 10' }),
  };
  const dropped = column({ name: 'dropped' });
  const fresh = column({ name: 'fresh' });

  expect(
    diffTables({
      base: [table({ columns: [kept, retyped.base, limited.base, dropped], indexes: [] })],
      head: [table({ columns: [kept, retyped.head, limited.head, fresh], indexes: [] })],
    }),
  ).toStrictEqual([
    {
      name: 'users',
      state: 'changed',
      options: { base: 'force: :cascade', head: 'force: :cascade' },
      columns: [
        { state: 'changed', ...retyped },
        { state: 'changed', ...limited },
        { state: 'added', head: fresh },
        { state: 'removed', base: dropped },
      ],
      indexes: [],
    },
  ]);
});

test('indexes pair by name and differ by their columns, in order, or their options', () => {
  const reordered = {
    base: index({ name: 'a', columns: ['x', 'y'] }),
    head: index({ name: 'a', columns: ['y', 'x'] }),
  };
  const narrowed = {
    base: index({ name: 'b', options: 'unique: true' }),
    head: index({ name: 'b', options: '' }),
  };
  const renamed = { base: index({ name: 'c' }), head: index({ name: 'd' }) };

  const [change] = diffTables({
    base: [table({ indexes: [reordered.base, narrowed.base, renamed.base] })],
    head: [table({ indexes: [reordered.head, narrowed.head, renamed.head] })],
  });

  expect(change?.indexes).toStrictEqual([
    { state: 'changed', ...reordered },
    { state: 'changed', ...narrowed },
    { state: 'added', head: renamed.head },
    { state: 'removed', base: renamed.base },
  ]);
});

test("a table's own options changing is a change with nothing else in it", () => {
  expect(
    diffTables({
      base: [table({ options: 'id: :uuid' })],
      head: [table({ options: 'id: :bigint' })],
    }),
  ).toStrictEqual([
    {
      name: 'users',
      state: 'changed',
      options: { base: 'id: :uuid', head: 'id: :bigint' },
      columns: [],
      indexes: [],
    },
  ]);
});

test('a table added holding nothing is still a change', () => {
  const empty = table({ options: '', columns: [], indexes: [] });

  expect(diffTables({ base: [], head: [empty] }).map(({ state }) => state)).toStrictEqual([
    'added',
  ]);
});
