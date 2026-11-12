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
    deployColumnFindings({
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

test.for(['lib/tasks/handles.rake', 'app/views/users/show.html.erb', 'lib/mongodb/sync.rb'])(
  'an added column named by %s raises it',
  path => {
    expect(
      deployColumnFindings({
        schemas: schemaAdding('nickname'),
        patches: [patchAdding(path, 'nickname')],
      }).map(({ id }) => id),
    ).toStrictEqual(['deploy:column-used:users.nickname']);
  },
);

test('a column name is matched as written, not as a pattern', () => {
  expect(
    deployColumnFindings({
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
  expect(deployColumnFindings({ schemas: schemaAdding('nickname'), patches })).toStrictEqual([]);
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
      deployColumnFindings({ schemas, patches: [patchAdding(MODEL, 'nickname')] }),
    ).toStrictEqual([]);
  },
);
