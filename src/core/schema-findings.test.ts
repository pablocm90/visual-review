import { expect, test } from 'vitest';
import type { SchemaReading } from './read-schemas.ts';
import type { SchemaColumn, SchemaIndex } from './schema.ts';
import type { SchemaChange, TableChange } from './schema-diff.ts';
import { schemaFindings } from './schema-findings.ts';

const FILE = 'db/schema.rb';

const column = (name: string): SchemaColumn => ({ name, type: 'string', options: '' });
const index = (name: string): SchemaIndex => ({ name, columns: [name], options: '' });

const added = <T>(head: T): SchemaChange<T> => ({ state: 'added', head });
const removed = <T>(base: T): SchemaChange<T> => ({ state: 'removed', base });
const changed = <T>(base: T): SchemaChange<T> => ({ state: 'changed', base, head: base });

const table = (overrides: Partial<TableChange> = {}): TableChange => ({
  name: 'users',
  state: 'changed',
  options: { base: '', head: '' },
  columns: [],
  indexes: [],
  ...overrides,
});

const inFile = (...tables: ReadonlyArray<TableChange>): ReadonlyArray<SchemaReading> => [
  { file: FILE, tables },
];

test('a changed table is one finding for information, opening its card and summing up its changes', () => {
  expect(
    schemaFindings(
      inFile(table({ columns: [added(column('a')), added(column('b')), removed(column('c'))] })),
    ),
  ).toStrictEqual([
    {
      id: `schema:${FILE}:users`,
      check: 'schema:table-changed',
      dimension: 'schema',
      level: 'info',
      file: FILE,
      table: 'users',
      title: 'users: 2 columns added, 1 removed',
      detail: FILE,
    },
  ]);
});

test.for([
  {
    what: 'a column changed',
    change: { columns: [changed(column('a'))] },
    title: 'users: 1 column changed',
  },
  {
    what: 'indexes beside columns',
    change: {
      columns: [removed(column('a'))],
      indexes: [changed(index('b')), added(index('c')), added(index('d'))],
    },
    title: 'users: 1 column removed, 2 indexes added, 1 changed',
  },
  {
    what: "the table's options",
    change: { options: { base: 'force: :cascade', head: 'force: :cascade, id: :uuid' } },
    title: 'users: table options changed',
  },
  {
    what: 'an added table, by what it holds',
    change: {
      state: 'added' as const,
      columns: [added(column('a'))],
      indexes: [added(index('b'))],
    },
    title: 'users added: 1 column, 1 index',
  },
])('$what reads in the title', ({ change, title }) => {
  expect(schemaFindings(inFile(table(change))).map(finding => finding.title)).toStrictEqual([
    title,
  ]);
});

test('an added table is for information and a removed one needs a look', () => {
  expect(
    schemaFindings(
      inFile(
        table({ name: 'a', state: 'added' }),
        table({
          name: 'b',
          state: 'removed',
          columns: [removed(column('x')), removed(column('y'))],
        }),
      ),
    ).map(({ check, level, title }) => ({ check, level, title })),
  ).toStrictEqual([
    { check: 'schema:table-changed', level: 'info', title: 'a added: 0 columns' },
    { check: 'schema:table-removed', level: 'look', title: 'b removed: 2 columns' },
  ]);
});

test('tables of one name in two files stay apart', () => {
  const other = 'db/queue_schema.rb';

  expect(
    schemaFindings([...inFile(table()), { file: other, tables: [table()] }]).map(({ id }) => id),
  ).toStrictEqual([`schema:${FILE}:users`, `schema:${other}:users`]);
});

test.for([
  { whole: 'added' as const, title: `${FILE} added, with 3 tables` },
  { whole: 'removed' as const, title: `${FILE} removed, with 3 tables` },
])('a schema file $whole is one finding for information, no table named', ({ whole, title }) => {
  expect(schemaFindings([{ file: FILE, whole, tableCount: 3 }])).toStrictEqual([
    {
      id: `schema:${FILE}`,
      check: 'schema:whole',
      dimension: 'schema',
      level: 'info',
      file: FILE,
      title,
    },
  ]);
});

test("a schema that couldn't be read is a finding to look at, naming why", () => {
  expect(schemaFindings([{ file: FILE, notRead: 'Ruby syntax error' }])).toStrictEqual([
    {
      id: `schema:not-read:${FILE}`,
      check: 'schema:not-read',
      dimension: 'schema',
      level: 'look',
      file: FILE,
      title: `${FILE} not read: Ruby syntax error`,
    },
  ]);
});
