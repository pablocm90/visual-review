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
