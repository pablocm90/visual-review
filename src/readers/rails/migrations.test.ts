import { expect, test } from 'vitest';
import { railsMigrations } from './migration-risks.ts';

const migration = (body: string) => `class Change < ActiveRecord::Migration[8.0]
  def change
    ${body}
  end
end
`;

const titles = (body: string) => railsMigrations.risks(migration(body)).map(({ title }) => title);

test('removing a column is a risk, on the line that removes it, with why', () => {
  expect(railsMigrations.risks(migration('remove_column :users, :name, :string'))).toStrictEqual([
    {
      title: 'column users.name removed',
      why: 'Code still running during the deploy may read it.',
      line: 3,
    },
  ]);
});

test.for([
  { written: 'remove_column "users", "name"', title: 'column users.name removed' },
  { written: 'remove_column(:users, :name)', title: 'column users.name removed' },
  { written: 'connection.remove_column :users, :name', title: 'column users.name removed' },
])('$written names its column however it is written', ({ written, title }) => {
  expect(titles(written)).toStrictEqual([title]);
});

test.for([
  {
    written: 'remove_columns :users, :name, :age',
    expected: ['column users.name removed', 'column users.age removed'],
  },
  {
    written: 'remove_columns :users, :name, :age, type: :string',
    expected: ['column users.name removed', 'column users.age removed'],
  },
  {
    written: 'remove_columns :users, :name, { type: :string }',
    expected: ['column users.name removed'],
  },
  { written: 'remove_reference :users, :account', expected: ['reference users.account removed'] },
  { written: 'remove_belongs_to :users, :account', expected: ['reference users.account removed'] },
  { written: 'remove_timestamps :users', expected: ['timestamps of users removed'] },
  { written: 'connection.remove_column', expected: [] },
  {
    written: 'rename_column :users, :name, :full_name',
    expected: ['column users.name renamed to full_name'],
  },
])('$written reads as what it takes away', ({ written, expected }) => {
  expect(titles(written)).toStrictEqual(expected);
});

test('changing a column type says what it becomes and why that is a risk', () => {
  expect(railsMigrations.risks(migration('change_column :users, :age, :bigint'))).toStrictEqual([
    {
      title: 'column users.age changed to bigint',
      why: 'A type change can rewrite the table under a lock, and running code expects the old type.',
      line: 3,
    },
  ]);
});

test('setting a column null: false says why that is a risk', () => {
  expect(
    railsMigrations.risks(migration('change_column_null :users, :email, false')),
  ).toStrictEqual([
    {
      title: 'column users.email set to null: false',
      why: 'Fails if a row holds NULL, and scans the table under a lock.',
      line: 3,
    },
  ]);
});

test.for([
  { written: 'change_column_null :users, :email, true', expected: [] },
  {
    written: 'change_column_null :users, :email, allow_null',
    expected: ['column users.email set to null: false'],
  },
])('$written is flagged unless it plainly allows NULL', ({ written, expected }) => {
  expect(titles(written)).toStrictEqual(expected);
});

test('adding a required column with no default says why that is a risk', () => {
  expect(
    railsMigrations.risks(migration('add_column :users, :email, :string, null: false')),
  ).toStrictEqual([
    {
      title: 'column users.email added as null: false with no default',
      why: 'Fails on a table with rows.',
      line: 3,
    },
  ]);
});

test.for([
  {
    written: 'add_column :users, :email, :string, :null => false',
    expected: ['column users.email added as null: false with no default'],
  },
  {
    written: 'add_column :users, :email, :string, { null: false }',
    expected: ['column users.email added as null: false with no default'],
  },
  {
    written: 'add_column :users, :email, :string, null: false, default: nil',
    expected: ['column users.email added as null: false with no default'],
  },
  { written: 'add_column :users, :email, :string', expected: [] },
  { written: 'add_column :users, :email, :string, null: true', expected: [] },
  { written: "add_column :users, :email, :string, null: false, default: ''", expected: [] },
  {
    written: 'add_reference :users, :account, null: false',
    expected: ['reference users.account added as null: false with no default'],
  },
  {
    written: 'add_belongs_to :users, :account, null: false',
    expected: ['reference users.account added as null: false with no default'],
  },
  { written: 'add_reference :users, :account', expected: [] },
  {
    written: 'add_timestamps :users',
    expected: ['timestamps of users added as null: false with no default'],
  },
  {
    written: 'add_timestamps :users, null: false',
    expected: ['timestamps of users added as null: false with no default'],
  },
  { written: 'add_timestamps :users, null: true', expected: [] },
  { written: "add_timestamps :users, default: -> { 'now()' }", expected: [] },
])('$written is flagged when rows would have no value', ({ written, expected }) => {
  expect(titles(written)).toStrictEqual(expected);
});

test('adding an index says why that is a risk', () => {
  expect(railsMigrations.risks(migration('add_index :orders, :user_id'))).toStrictEqual([
    {
      title: 'index on orders (user_id) added, not concurrently',
      why: 'Blocks writes to the table while the index builds.',
      line: 3,
    },
  ]);
});

test.for([
  {
    written: 'add_index :orders, [:user_id, "state"]',
    expected: ['index on orders (user_id, state) added, not concurrently'],
  },
  {
    written: 'add_index :orders, :user_id, unique: true',
    expected: ['index on orders (user_id) added, not concurrently'],
  },
  {
    written: 'add_index :orders, :user_id, algorithm: :inplace',
    expected: ['index on orders (user_id) added, not concurrently'],
  },
  { written: 'add_index :orders, :user_id, algorithm: :concurrently', expected: [] },
  { written: 'add_index :orders, :user_id, :algorithm => :concurrently', expected: [] },
])('$written is flagged unless built concurrently', ({ written, expected }) => {
  expect(titles(written)).toStrictEqual(expected);
});

test.for([
  { written: 'create_table :orders\n    add_index :orders, :user_id', expected: [] },
  {
    written: 'add_column :orders, :state, :string, null: false\n    create_table "orders"',
    expected: [],
  },
  { written: 'create_table :orders\n    add_reference :orders, :user, null: false', expected: [] },
  { written: 'create_table :orders\n    add_belongs_to :orders, :user, null: false', expected: [] },
  { written: 'create_table :orders\n    add_timestamps :orders', expected: [] },
  {
    written: 'create_table :orders\n    add_index :users, :email',
    expected: ['index on users (email) added, not concurrently'],
  },
  {
    written: 'create_table :orders\n    remove_column :orders, :state',
    expected: ['column orders.state removed'],
  },
])('a table created in the same file has no rows to protect: $written', ({ written, expected }) => {
  expect(titles(written)).toStrictEqual(expected);
});
