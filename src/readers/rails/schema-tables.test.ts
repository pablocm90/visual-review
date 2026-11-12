import { expect, test } from 'vitest';
import { railsSchema } from './schema-tables.ts';

const dump = (body: string) => `ActiveRecord::Schema[8.0].define(version: 2026_01_01_000000) do
  enable_extension "pgcrypto"

${body}

  add_foreign_key "orders", "users"
end
`;

test('a dumped table reads with its options, its columns and its indexes', () => {
  expect(
    railsSchema.tables(
      dump(`  create_table "users", id: :uuid, force: :cascade do |t|
    t.string "email", limit: 255, null: false
    t.decimal "balance", precision: 10, scale: 2, default: "0.0"
    t.datetime "created_at"
    t.index ["account_id", "email"], name: "index_users_on_account_and_email", unique: true, where: "(email IS NOT NULL)"
    t.index "lower((\\"Email\\")::text)", name: "index_users_on_lower_email"
    t.check_constraint "balance >= 0", name: "balance_positive"
  end`),
    ),
  ).toStrictEqual([
    {
      name: 'users',
      options: 'id: :uuid, force: :cascade',
      columns: [
        { name: 'email', type: 'string', options: 'limit: 255, null: false' },
        { name: 'balance', type: 'decimal', options: 'precision: 10, scale: 2, default: "0.0"' },
        { name: 'created_at', type: 'datetime', options: '' },
      ],
      indexes: [
        {
          name: 'index_users_on_account_and_email',
          columns: ['account_id', 'email'],
          options: 'unique: true, where: "(email IS NOT NULL)"',
        },
        {
          name: 'index_users_on_lower_email',
          columns: ['lower((\\"Email\\")::text)'],
          options: '',
        },
      ],
    },
  ]);
});

test('any type word is a column, custom ones too', () => {
  const [table] = railsSchema.tables(
    dump(`  create_table "users" do |t|
    t.enum "state", enum_type: "user_state", null: false
    t.virtual "full_name", type: :string, as: "first || last", stored: true
  end`),
  );

  expect(table?.columns).toStrictEqual([
    { name: 'state', type: 'enum', options: 'enum_type: "user_state", null: false' },
    {
      name: 'full_name',
      type: 'virtual',
      options: 'type: :string, as: "first || last", stored: true',
    },
  ]);
});

test('a table without a block has no columns, and each table keeps its own', () => {
  expect(
    railsSchema.tables(
      dump(`  create_table "empty"
  create_table "orders" do |o|
    o.integer "total"
  end`),
    ),
  ).toStrictEqual([
    { name: 'empty', options: '', columns: [], indexes: [] },
    {
      name: 'orders',
      options: '',
      columns: [{ name: 'total', type: 'integer', options: '' }],
      indexes: [],
    },
  ]);
});

test('an index written without a name goes by its columns', () => {
  const [table] = railsSchema.tables(
    dump(`  create_table "users" do |t|
    t.index ["account_id", "email"]
  end`),
  );

  expect(table?.indexes).toStrictEqual([
    { name: 'account_id, email', columns: ['account_id', 'email'], options: '' },
  ]);
});

test('a call on anything but the block parameter is not a column', () => {
  const [table] = railsSchema.tables(
    dump(`  create_table "users" do |t|
    Rails.logger.info "reading"
    t.string "email"
  end`),
  );

  expect(table?.columns).toStrictEqual([{ name: 'email', type: 'string', options: '' }]);
});

test.for(['check_constraint', 'exclusion_constraint', 'foreign_key', 'unique_constraint'])(
  't.%s is no column',
  method => {
    const [table] = railsSchema.tables(
      dump(`  create_table "users" do |t|
    t.${method} "balance >= 0"
  end`),
    );

    expect(table?.columns).toStrictEqual([]);
  },
);

test('a schema with no tables reads none', () => {
  expect(railsSchema.tables('DataMigrate::Data.define(version: 20260101000000)\n')).toStrictEqual(
    [],
  );
});

test('a syntax error throws rather than reading part of the schema', () => {
  expect(() => railsSchema.tables(dump('  create_table "users" do |t|'))).toThrow(
    'Ruby syntax error',
  );
});

test.for([
  { path: 'db/schema.rb', holds: true },
  { path: 'apps/billing/db/schema.rb', holds: true },
  { path: 'db/animals_schema.rb', holds: true },
  { path: 'db/data_schema.rb', holds: true },
  { path: 'contest/db/schema.rb', holds: true },
  { path: 'db/schema.sql', holds: false },
  { path: 'db/schema.rb.bak', holds: false },
  { path: 'db/structure.sql', holds: false },
  { path: 'db/schemas.rb', holds: false },
  { path: 'db/old/schema.rb', holds: false },
  { path: 'mydb/schema.rb', holds: false },
  { path: 'schema.rb', holds: false },
  { path: 'vendor/gem/db/schema.rb', holds: false },
  { path: 'node_modules/gem/db/schema.rb', holds: false },
  { path: 'test/dummy/db/schema.rb', holds: false },
  { path: 'spec/dummy/db/schema.rb', holds: false },
])('holds $path: $holds', ({ path, holds }) => {
  expect(railsSchema.holds(path)).toBe(holds);
});

test.for([
  {
    reason: 'the names it assigns, strings and symbols, on the table its file names',
    path: 'app/models/user.rb',
    text: 'class User < ApplicationRecord\n  self.ignored_columns = ["nickname", :handle]\nend\n',
    ignored: [
      { table: 'users', column: 'nickname' },
      { table: 'users', column: 'handle' },
    ],
  },
  {
    reason: 'the words it adds, on the plural of a nested file, prefixed by its folders or not',
    path: 'app/models/billing/admin/category.rb',
    text: 'class Billing::Admin::Category < ApplicationRecord\n  self.ignored_columns += %w[slug]\nend\n',
    ignored: [
      { table: 'categories', column: 'slug' },
      { table: 'billing_admin_categories', column: 'slug' },
    ],
  },
  {
    reason: 'the table its table_name sets',
    path: 'app/models/person.rb',
    text: 'class Person < ApplicationRecord\n  self.table_name = "humans"\n  self.ignored_columns = [:age]\nend\n',
    ignored: [{ table: 'humans', column: 'age' }],
  },
  {
    reason: 'none when it only mentions them',
    path: 'app/models/user.rb',
    text: 'class User < ApplicationRecord\n  # ignored_columns once held nickname\nend\n',
    ignored: [],
  },
])('a model ignores $reason', ({ path, text, ignored }) => {
  expect(railsSchema.ignored({ path, text })).toStrictEqual(ignored);
});
