import { expect, test } from 'vitest';
import { deployColumnFindings } from './deploy-columns.ts';
import type { FilePatch } from './diff-graphs.ts';
import type { SchemaReading } from './read-schemas.ts';
import type { SchemaColumn } from './schema.ts';
import type { SchemaChange, TableChange } from './schema-diff.ts';

const column = (name: string): SchemaColumn => ({ name, type: 'string', options: '' });

const added = (name: string): SchemaChange<SchemaColumn> => ({
  state: 'added',
  head: column(name),
});

const table = (overrides: Partial<TableChange> = {}): TableChange => ({
  name: 'users',
  state: 'changed',
  options: { base: '', head: '' },
  columns: [],
  indexes: [],
  ...overrides,
});

const schemaAdding = (...names: ReadonlyArray<string>): ReadonlyArray<SchemaReading> => [
  { file: 'db/schema.rb', tables: [table({ columns: names.map(added) })] },
];

const MODEL = 'app/models/user.rb';

const NICKNAME_IGNORED = [{ table: 'users', column: 'nickname' }];

const findingsOf = (options: Partial<Parameters<typeof deployColumnFindings>[0]>) =>
  deployColumnFindings({
    schemas: [],
    patches: [],
    namedAtHead: [],
    ignoredAtBase: [],
    ...options,
  });

const patchAdding = (path: string, ...added: ReadonlyArray<string>): FilePatch => ({
  path,
  patch: [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,1 +1,${added.length + 1} @@`,
    ' class User < ApplicationRecord',
    ...added.map(line => `+${line}`),
  ].join('\n'),
});

test('an added column that code the change adds names is for information, on its first row: migrate first or guard', () => {
  expect(
    findingsOf({
      schemas: schemaAdding('nickname'),
      patches: [patchAdding(MODEL, '  def handle = nickname.presence || email', '  # nickname')],
    }),
  ).toStrictEqual([
    {
      id: 'deploy:column-used:users.nickname',
      check: 'deploy:column-used',
      dimension: 'deploy',
      level: 'info',
      file: MODEL,
      line: `${MODEL}@head:2`,
      title: `${MODEL} names the new column users.nickname`,
      detail:
        'On a rolling deploy this code can run before the migration: migrate first or guard it. Matched by name.',
    },
  ]);
});

test.for([
  'lib/tasks/handles.rake',
  'app/views/users/show.html.erb',
  'app/views/users/show.json.jbuilder',
  'app/views/users/show.html.slim',
  'app/views/users/show.html.haml',
  'lib/mongodb/sync.rb',
])('an added column named by %s raises it', path => {
  expect(
    findingsOf({
      schemas: schemaAdding('nickname'),
      patches: [patchAdding(path, 'nickname')],
    }).map(({ id }) => id),
  ).toStrictEqual(['deploy:column-used:users.nickname']);
});

test('a column name is matched as written, not as a pattern', () => {
  expect(
    findingsOf({
      schemas: schemaAdding('rate.usd'),
      patches: [patchAdding(MODEL, 'rate_usd')],
    }),
  ).toStrictEqual([]);
});

const removed = (name: string): SchemaChange<SchemaColumn> => ({
  state: 'removed',
  base: column(name),
});

test.for([
  {
    reason: 'a row the change keeps',
    patches: [{ path: MODEL, patch: '@@ -1,1 +1,1 @@\n nickname' }],
  },
  { reason: 'a name it starts', patches: [patchAdding(MODEL, 'nicknames')] },
  { reason: 'a name it ends', patches: [patchAdding(MODEL, 'old_nickname')] },
  { reason: 'a migration', patches: [patchAdding('db/migrate/1_add_nickname.rb', 'nickname')] },
  { reason: 'a spec', patches: [patchAdding('spec/models/user_spec.rb', 'nickname')] },
  { reason: 'a TypeScript file', patches: [patchAdding('web/user.ts', 'nickname')] },
])('an added column named only by $reason raises nothing', ({ patches }) => {
  expect(findingsOf({ schemas: schemaAdding('nickname'), patches })).toStrictEqual([]);
});

test.for([
  {
    reason: 'a removed column',
    schemas: [{ file: 'db/schema.rb', tables: [table({ columns: [removed('nickname')] })] }],
  },
  {
    reason: 'a dump added whole',
    schemas: [{ file: 'db/schema.rb', whole: 'added', tableCount: 1 }],
  },
] satisfies ReadonlyArray<{ reason: string; schemas: ReadonlyArray<SchemaReading> }>)(
  '$reason named by added code is not a new column',
  ({ schemas }) => {
    expect(
      findingsOf({
        schemas,
        patches: [patchAdding(MODEL, 'nickname')],
        ignoredAtBase: NICKNAME_IGNORED,
      }),
    ).toStrictEqual([]);
  },
);

const schemaRemoving = (...names: ReadonlyArray<string>): ReadonlyArray<SchemaReading> => [
  { file: 'db/schema.rb', tables: [table({ columns: names.map(removed) })] },
];

test.for([
  { reason: 'adds', state: 'added', columns: [added('nickname')] },
  { reason: 'drops', state: 'removed', columns: [removed('nickname')] },
] as const)('the columns of a table the dump $reason whole raise nothing', ({ state, columns }) => {
  expect(
    findingsOf({
      schemas: [{ file: 'db/schema.rb', tables: [table({ state, columns: [...columns] })] }],
      patches: [patchAdding(MODEL, 'nickname')],
      namedAtHead: [{ path: MODEL, column: 'nickname' }],
    }),
  ).toStrictEqual([]);
});

test('a removed column no model ignores at the base is to look at, on its table: ignore it in a deploy first', () => {
  expect(
    findingsOf({
      schemas: [{ file: 'api/db/schema.rb', tables: [table({ columns: [removed('nickname')] })] }],
    }),
  ).toStrictEqual([
    {
      id: 'deploy:not-ignored:users.nickname',
      check: 'deploy:not-ignored',
      dimension: 'deploy',
      level: 'look',
      file: 'api/db/schema.rb',
      table: 'users',
      title: 'api/db/schema.rb drops users.nickname, which no model ignored at the base',
      detail:
        'Code running the base during the deploy still loads it: ignore it in a deploy before dropping it. Matched by name.',
    },
  ]);
});

test.for([
  { reason: 'its table', ignoredAtBase: NICKNAME_IGNORED, ids: [] },
  {
    reason: 'another table',
    ignoredAtBase: [{ table: 'accounts', column: 'nickname' }],
    ids: ['deploy:not-ignored:users.nickname'],
  },
  {
    reason: 'another column of its table',
    ignoredAtBase: [{ table: 'users', column: 'email' }],
    ids: ['deploy:not-ignored:users.nickname'],
  },
])(
  'a removed column with the base ignoring it at $reason raises $ids',
  ({ ignoredAtBase, ids }) => {
    expect(
      findingsOf({ schemas: schemaRemoving('nickname'), ignoredAtBase }).map(({ id }) => id),
    ).toStrictEqual(ids);
  },
);

test('a removed column that app code at the head still names is to look at: ignore it in a deploy first', () => {
  expect(
    findingsOf({
      schemas: schemaRemoving('nickname'),
      namedAtHead: [{ path: MODEL, column: 'nickname' }],
      ignoredAtBase: NICKNAME_IGNORED,
    }),
  ).toStrictEqual([
    {
      id: 'deploy:column-still-read:users.nickname',
      check: 'deploy:column-still-read',
      dimension: 'deploy',
      level: 'look',
      file: MODEL,
      title: `${MODEL} still names the removed column users.nickname`,
      detail:
        'Code running during the deploy may read it: ignore it in a deploy before dropping it. Matched by name.',
    },
  ]);
});

test.for([
  { reason: 'another column', namedAtHead: [{ path: MODEL, column: 'email' }] },
  { reason: 'a spec', namedAtHead: [{ path: 'spec/models/user_spec.rb', column: 'nickname' }] },
  {
    reason: 'a TypeScript file',
    namedAtHead: [{ path: 'app/javascript/user.ts', column: 'nickname' }],
  },
])(
  'a removed column whose name the head reads only in $reason raises nothing',
  ({ namedAtHead }) => {
    expect(
      findingsOf({
        schemas: schemaRemoving('nickname'),
        namedAtHead,
        ignoredAtBase: NICKNAME_IGNORED,
      }),
    ).toStrictEqual([]);
  },
);
