import { expect, test } from 'vitest';
import { readRange } from '../test-support/read-range.ts';
import { commit, git, gitRepo } from '../test-support/repos.ts';

const FILE = 'db/schema.rb';

const dump = (body: string, version = '2026_01_01_000000') =>
  `ActiveRecord::Schema[8.0].define(version: ${version}) do
${body}
end
`;

const USERS = `  create_table "users", force: :cascade do |t|
    t.string "email", null: false
    t.string "name"
    t.index ["email"], name: "index_users_on_email"
    t.index ["name"], name: "index_users_on_name"
  end`;

const usersChange = {
  name: 'users',
  state: 'changed',
  options: { base: 'force: :cascade', head: 'force: :cascade' },
};

test('a changed schema reads as added, removed and changed tables, columns and indexes', async () => {
  using workspace = gitRepo({
    [FILE]: dump(`${USERS}
  create_table "gone", force: :cascade do |t|
    t.string "reason"
  end`),
  });
  const { repo, root } = workspace;
  const to = commit(repo, {
    [FILE]: dump(`  create_table "users", force: :cascade do |t|
    t.string "email", limit: 255, null: false
    t.integer "age"
    t.index ["email"], name: "index_users_on_email", unique: true
    t.index ["age"], name: "index_users_on_age"
  end
  create_table "orders", force: :cascade do |t|
    t.integer "total"
    t.index ["total"], name: "index_orders_on_total"
  end`),
  });

  const { schemas } = await readRange({ repo, from: root, to });

  expect(schemas).toStrictEqual([
    {
      file: FILE,
      tables: [
        {
          ...usersChange,
          columns: [
            {
              state: 'changed',
              base: { name: 'email', type: 'string', options: 'null: false' },
              head: { name: 'email', type: 'string', options: 'limit: 255, null: false' },
            },
            { state: 'added', head: { name: 'age', type: 'integer', options: '' } },
            { state: 'removed', base: { name: 'name', type: 'string', options: '' } },
          ],
          indexes: [
            {
              state: 'changed',
              base: { name: 'index_users_on_email', columns: ['email'], options: '' },
              head: { name: 'index_users_on_email', columns: ['email'], options: 'unique: true' },
            },
            {
              state: 'added',
              head: { name: 'index_users_on_age', columns: ['age'], options: '' },
            },
            {
              state: 'removed',
              base: { name: 'index_users_on_name', columns: ['name'], options: '' },
            },
          ],
        },
        {
          name: 'orders',
          state: 'added',
          options: { base: '', head: 'force: :cascade' },
          columns: [{ state: 'added', head: { name: 'total', type: 'integer', options: '' } }],
          indexes: [
            {
              state: 'added',
              head: { name: 'index_orders_on_total', columns: ['total'], options: '' },
            },
          ],
        },
        {
          name: 'gone',
          state: 'removed',
          options: { base: 'force: :cascade', head: '' },
          columns: [{ state: 'removed', base: { name: 'reason', type: 'string', options: '' } }],
          indexes: [],
        },
      ],
    },
  ]);
});

test.for([
  {
    reason: 'a schema where only the version changed',
    path: FILE,
    base: dump(USERS),
    head: dump(USERS, '2026_02_02_000000'),
  },
  {
    reason: 'a schema outside the paths Rails runs',
    path: 'test/dummy/db/schema.rb',
    base: dump(USERS),
    head: dump(''),
  },
])('$reason shows nothing', async ({ path, base, head }) => {
  using workspace = gitRepo({ [path]: base });
  const { repo, root } = workspace;
  const to = commit(repo, { [path]: head });

  const { schemas } = await readRange({ repo, from: root, to });

  expect(schemas).toStrictEqual([]);
});

test('a schema new in the range is one entry, not a table added per table', async () => {
  using workspace = gitRepo({ 'README.md': 'app' });
  const { repo, root } = workspace;
  const to = commit(repo, { [FILE]: dump(USERS) });

  const { schemas } = await readRange({ repo, from: root, to });

  expect(schemas).toStrictEqual([{ file: FILE, whole: 'added', tableCount: 1 }]);
});

test('a schema deleted in the range is one entry, not a table removed per table', async () => {
  using workspace = gitRepo({ [FILE]: dump(USERS), 'README.md': 'app' });
  const { repo, root } = workspace;
  git(repo, 'rm', '-q', FILE);
  const to = commit(repo, { 'README.md': 'still an app' });

  const { schemas } = await readRange({ repo, from: root, to });

  expect(schemas).toStrictEqual([{ file: FILE, whole: 'removed', tableCount: 1 }]);
});

test('a schema file holding no tables says nothing when added', async () => {
  using workspace = gitRepo({ 'README.md': 'app' });
  const { repo, root } = workspace;
  const to = commit(repo, { 'db/data_schema.rb': 'DataMigrate::Data.define(version: 1)\n' });

  const { schemas } = await readRange({ repo, from: root, to });

  expect(schemas).toStrictEqual([]);
});

test('a renamed schema compares with its first path and goes by its last', async () => {
  const renamed = 'db/primary_schema.rb';
  const many = Array.from({ length: 30 }, (_, n) => `    t.string "c${n}"`).join('\n');
  const table = (extra: string) => `  create_table "users" do |t|\n${many}\n${extra}\n  end`;
  using workspace = gitRepo({ [FILE]: dump(table('')) });
  const { repo, root } = workspace;
  git(repo, 'mv', FILE, renamed);
  const to = commit(repo, { [renamed]: dump(table('    t.string "fresh"')) });

  const { schemas } = await readRange({ repo, from: root, to });

  expect(schemas).toStrictEqual([
    {
      file: renamed,
      tables: [
        {
          name: 'users',
          state: 'changed',
          options: { base: '', head: '' },
          columns: [{ state: 'added', head: { name: 'fresh', type: 'string', options: '' } }],
          indexes: [],
        },
      ],
    },
  ]);
});

test('a schema renamed out of the paths held counts as removed, under its first path', async () => {
  using workspace = gitRepo({ [FILE]: dump(USERS), 'README.md': 'app' });
  const { repo, root } = workspace;
  git(repo, 'mv', FILE, 'db/old.rb');
  const to = commit(repo, { 'README.md': 'still an app' });

  const { schemas } = await readRange({ repo, from: root, to });

  expect(schemas).toStrictEqual([{ file: FILE, whole: 'removed', tableCount: 1 }]);
});

test('a table of one name in two databases stays apart, each under its file', async () => {
  const other = 'db/animals_schema.rb';
  using workspace = gitRepo({ [FILE]: dump(USERS), [other]: dump(USERS) });
  const { repo, root } = workspace;
  const to = commit(repo, {
    [FILE]: dump(USERS.replace('t.string "email", null: false', 't.text "email"')),
    [other]: dump(USERS.replace('t.string "name"', 't.text "name"')),
  });

  const { schemas } = await readRange({ repo, from: root, to });

  const retyped = schemas.map(reading => [
    reading.file,
    'tables' in reading
      ? reading.tables.flatMap(({ columns }) =>
          columns.flatMap(change => (change.state === 'changed' ? [change.head.name] : [])),
        )
      : [],
  ]);
  expect(retyped).toStrictEqual([
    [other, ['name']],
    [FILE, ['email']],
  ]);
});

test.for([
  { side: 'head', base: dump(USERS), head: 'create_table "users" do |t|\n' },
  { side: 'base', base: 'create_table "users" do |t|\n', head: dump(USERS) },
])('a syntax error at the $side is listed as not read', async ({ base, head }) => {
  using workspace = gitRepo({ [FILE]: base });
  const { repo, root } = workspace;
  const to = commit(repo, { [FILE]: head });

  const { schemas } = await readRange({ repo, from: root, to });

  expect(schemas).toStrictEqual([{ file: FILE, notRead: 'Ruby syntax error' }]);
});

test('a new schema with a syntax error is listed as not read', async () => {
  using workspace = gitRepo({ 'README.md': 'app' });
  const { repo, root } = workspace;
  const to = commit(repo, { [FILE]: 'create_table "users" do |t|\n' });

  const { schemas } = await readRange({ repo, from: root, to });

  expect(schemas).toStrictEqual([{ file: FILE, notRead: 'Ruby syntax error' }]);
});

test.for([
  { to: 'db/old.rb', file: FILE },
  { to: 'db/primary_schema.rb', file: 'db/primary_schema.rb' },
])('a broken schema renamed to $to is listed as not read at $file', async ({ to: path, file }) => {
  using workspace = gitRepo({ [FILE]: 'create_table "users" do |t|\n', 'README.md': 'app' });
  const { repo, root } = workspace;
  git(repo, 'mv', FILE, path);
  const to = commit(repo, { 'README.md': 'still an app' });

  const { schemas } = await readRange({ repo, from: root, to });

  expect(schemas).toStrictEqual([{ file, notRead: 'Ruby syntax error' }]);
});

test('a file renamed into the paths held counts as added, under its last path', async () => {
  using workspace = gitRepo({ 'db/old.rb': dump(USERS), 'README.md': 'app' });
  const { repo, root } = workspace;
  git(repo, 'mv', 'db/old.rb', FILE);
  const to = commit(repo, { 'README.md': 'still an app' });

  const { schemas } = await readRange({ repo, from: root, to });

  expect(schemas).toStrictEqual([{ file: FILE, whole: 'added', tableCount: 1 }]);
});

test('a schema file holding no tables says nothing when deleted', async () => {
  const empty = 'db/data_schema.rb';
  using workspace = gitRepo({
    [empty]: 'DataMigrate::Data.define(version: 1)\n',
    'README.md': 'app',
  });
  const { repo, root } = workspace;
  git(repo, 'rm', '-q', empty);
  const to = commit(repo, { 'README.md': 'still an app' });

  const { schemas } = await readRange({ repo, from: root, to });

  expect(schemas).toStrictEqual([]);
});

test.for([
  {
    reason: 'every file naming it, once each',
    model: 'class User\n  def label = name.presence || name || email\nend\n',
    head: `  create_table "users", force: :cascade do |t|
    t.string "email", null: false
    t.index ["email"], name: "index_users_on_email"
  end`,
    named: [
      { path: 'app/models/user.rb', column: 'name' },
      { path: FILE, column: 'name' },
    ],
  },
  {
    reason: 'each column a file names',
    model: 'class User\n  def label = name.presence || name || email\nend\n',
    head: `  create_table "users", force: :cascade do |t|
  end`,
    named: [
      { path: 'app/models/user.rb', column: 'name' },
      { path: 'app/models/user.rb', column: 'email' },
    ],
  },
  {
    reason: 'none when no file names it',
    model: 'class User\nend\n',
    head: `  create_table "users", force: :cascade do |t|
    t.string "name"
  end`,
    named: [],
  },
])('a removed column is looked up by name at the head: $reason', async ({ model, head, named }) => {
  using workspace = gitRepo({
    [FILE]: dump(USERS),
    'app/models/user.rb': model,
    'app/models/name_tag.rb': 'class NameTag\n  def names = []\nend\n',
  });
  const { repo, root } = workspace;
  git(repo, 'config', 'grep.lineNumber', 'true');
  git(repo, 'config', 'grep.column', 'true');
  const to = commit(repo, { [FILE]: dump(head) });

  const { columnsNamedAtHead } = await readRange({ repo, from: root, to });

  expect(columnsNamedAtHead).toStrictEqual(named);
});

test("the columns ignored are read from the base's models, not the head's", async () => {
  using workspace = gitRepo({
    [FILE]: dump(USERS),
    'app/models/user.rb': 'class User\n  self.ignored_columns = ["name"]\nend\n',
  });
  const { repo, root } = workspace;
  const to = commit(repo, {
    [FILE]: dump(`  create_table "users", force: :cascade do |t|
  end`),
    'app/models/user.rb': 'class User\n  self.ignored_columns = ["name", "email"]\nend\n',
  });

  const { columnsIgnoredAtBase } = await readRange({ repo, from: root, to });

  expect(columnsIgnoredAtBase).toStrictEqual([{ table: 'users', column: 'name' }]);
});

test('a model at a path git would quote is read for the columns it ignores', async () => {
  using workspace = gitRepo({
    [FILE]: dump(USERS),
    'app/models/café.rb':
      'class Café < ApplicationRecord\n  self.table_name = "users"\n  self.ignored_columns = ["name"]\nend\n',
  });
  const { repo, root } = workspace;
  const to = commit(repo, {
    [FILE]: dump(`  create_table "users", force: :cascade do |t|
  end`),
  });

  const { columnsIgnoredAtBase } = await readRange({ repo, from: root, to });

  expect(columnsIgnoredAtBase).toStrictEqual([{ table: 'users', column: 'name' }]);
});

test('a file other than Ruby quoting ignored_columns ignores no column', async () => {
  using workspace = gitRepo({
    [FILE]: dump(USERS),
    'docs/user.md': 'Before dropping it:\n\n    self.ignored_columns = ["name"]\n',
  });
  const { repo, root } = workspace;
  const to = commit(repo, {
    [FILE]: dump(`  create_table "users", force: :cascade do |t|
  end`),
  });

  const { columnsIgnoredAtBase } = await readRange({ repo, from: root, to });

  expect(columnsIgnoredAtBase).toStrictEqual([]);
});
