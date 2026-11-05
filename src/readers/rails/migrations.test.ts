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
  { written: 'add_column :users, :email, :string, index: true', expected: [] },
  { written: 'add_column :users, :email, :string, null: true', expected: [] },
  { written: "add_column :users, :email, :string, null: false, default: ''", expected: [] },
  {
    written: 'add_reference :users, :account, null: false, index: false',
    expected: ['reference users.account added as null: false with no default'],
  },
  {
    written: 'add_belongs_to :users, :account, null: false, index: false',
    expected: ['reference users.account added as null: false with no default'],
  },
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
  {
    written: 'add_index :orders, %i[user_id state]',
    expected: ['index on orders (user_id, state) added, not concurrently'],
  },
  {
    written: 'add_index :orders, %w[user_id state]',
    expected: ['index on orders (user_id, state) added, not concurrently'],
  },
  { written: 'add_index :orders, :user_id, algorithm: :concurrently', expected: [] },
  { written: 'add_index :orders, :user_id, :algorithm => :concurrently', expected: [] },
])('$written is flagged unless built concurrently', ({ written, expected }) => {
  expect(titles(written)).toStrictEqual(expected);
});

test.for([{ method: 'add_reference' }, { method: 'add_belongs_to' }])(
  '$method indexes its column, so it blocks writes as add_index does',
  ({ method }) => {
    expect(railsMigrations.risks(migration(`${method} :orders, :user`))).toStrictEqual([
      {
        title: 'index on orders (user_id) added, not concurrently',
        why: 'Blocks writes to the table while the index builds.',
        line: 3,
      },
    ]);
  },
);

test.for([
  { written: 'add_reference :orders, :user, index: false', expected: [] },
  { written: 'add_reference :orders, :user, :index => false', expected: [] },
  { written: 'add_reference :orders, :user, index: nil', expected: [] },
  {
    written: 'add_reference :orders, :user, index: true',
    expected: ['index on orders (user_id) added, not concurrently'],
  },
  {
    written: 'add_reference :orders, :user, index: { unique: true }',
    expected: ['index on orders (user_id) added, not concurrently'],
  },
  {
    written: 'add_reference :orders, :user, index: wanted',
    expected: ['index on orders (user_id) added, not concurrently'],
  },
  { written: 'add_reference :orders, :user, index: { algorithm: :concurrently }', expected: [] },
  {
    written: 'add_reference :orders, :user, index: { algorithm: :inplace }',
    expected: ['index on orders (user_id) added, not concurrently'],
  },
])(
  '$written is flagged unless its index is plainly off or built concurrently',
  ({ written, expected }) => {
    expect(titles(written)).toStrictEqual(expected);
  },
);

test.for([
  {
    written: 'add_reference :orders, :owner, polymorphic: true',
    expected: ['index on orders (owner_type, owner_id) added, not concurrently'],
  },
  {
    written: "add_reference :orders, :owner, polymorphic: { default: 'User' }",
    expected: ['index on orders (owner_type, owner_id) added, not concurrently'],
  },
  {
    written: 'add_reference :orders, :owner, polymorphic: false',
    expected: ['index on orders (owner_id) added, not concurrently'],
  },
])('$written names the columns its index covers', ({ written, expected }) => {
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
  { written: 'create_table :orders\n    change_column_null :orders, :state, false', expected: [] },
  {
    written:
      'create_table :orders\n    change_table :orders do |t|\n      t.change_null :state, false\n    end',
    expected: [],
  },
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

test.for([
  {
    written: 'remove_columns :users,\n      :a, # legacy\n      :b',
    expected: ['column users.a removed', 'column users.b removed'],
  },
  {
    written: 'remove_column(\n      # why\n      :users, :name\n    )',
    expected: ['column users.name removed'],
  },
  { written: 'change_column_null :users, :email, # allow\n      true', expected: [] },
  {
    written: 'add_index :orders, [:a, # first\n      :b]',
    expected: ['index on orders (a, b) added, not concurrently'],
  },
])('a comment among the arguments is no argument: $written', ({ written, expected }) => {
  expect(titles(written)).toStrictEqual(expected);
});

const inClass = (body: string) => `class Change < ActiveRecord::Migration[8.0]
${body}
end
`;

test.for([
  {
    reads: 'def up and def down',
    written: `def up
    remove_column :users, :up_side
  end
  def down
    remove_column :users, :down_side
  end`,
  },
  {
    reads: 'def self.up and def self.down',
    written: `def self.up
    remove_column :users, :up_side
  end
  def self.down
    remove_column :users, :down_side
  end`,
  },
  {
    reads: 'dir.up and dir.down',
    written: `def change
    reversible do |dir|
      dir.up { remove_column :users, :up_side }
      dir.down { remove_column :users, :down_side }
    end
  end`,
  },
  {
    reads: 'a revert block',
    written: `def change
    revert { remove_column :users, :down_side }
    remove_column :users, :up_side
  end`,
  },
  {
    reads: 'a helper beside def down',
    written: `def strip
    remove_column :users, :up_side
  end
  def down
    remove_column :users, :down_side
  end`,
  },
])('only what runs going up is read: $reads', ({ written }) => {
  expect(railsMigrations.risks(inClass(written)).map(({ title }) => title)).toStrictEqual([
    'column users.up_side removed',
  ]);
});

test('a table created going down is no new table going up', () => {
  const written = `def up
    add_index :orders, :state, algorithm: :concurrently
    add_index :users, :email
  end
  def down
    create_table :users
  end`;
  expect(railsMigrations.risks(inClass(written)).map(({ title }) => title)).toStrictEqual([
    'index on users (email) added, not concurrently',
  ]);
});

const inChangeTable = (body: string) =>
  migration(`change_table :users, bulk: true do |t|
      ${body}
    end`);

test.for([
  {
    written: 't.remove :name, :age',
    expected: ['column users.name removed', 'column users.age removed'],
  },
  { written: 't.remove_references :account', expected: ['reference users.account removed'] },
  { written: 't.remove_belongs_to :account', expected: ['reference users.account removed'] },
  { written: 't.remove_timestamps', expected: ['timestamps of users removed'] },
  { written: 't.rename :name, :full_name', expected: ['column users.name renamed to full_name'] },
  { written: 't.change :age, :bigint', expected: ['column users.age changed to bigint'] },
  { written: 't.change_null :email, false', expected: ['column users.email set to null: false'] },
  { written: 't.change_null :email, true', expected: [] },
  {
    written: 't.string :email, null: false',
    expected: ['column users.email added as null: false with no default'],
  },
  {
    written: 't.text :bio, :motto, null: false',
    expected: [
      'column users.bio added as null: false with no default',
      'column users.motto added as null: false with no default',
    ],
  },
  { written: 't.string :email', expected: [] },
  {
    written: 't.column :email, :string, null: false',
    expected: ['column users.email added as null: false with no default'],
  },
  {
    written: 't.references :account, null: false, index: false',
    expected: ['reference users.account added as null: false with no default'],
  },
  {
    written: 't.belongs_to :account, null: false, index: false',
    expected: ['reference users.account added as null: false with no default'],
  },
  {
    written: 't.references :account',
    expected: ['index on users (account_id) added, not concurrently'],
  },
  {
    written: 't.belongs_to :account, :plan',
    expected: [
      'index on users (account_id) added, not concurrently',
      'index on users (plan_id) added, not concurrently',
    ],
  },
  { written: 't.references :account, index: false', expected: [] },
  {
    written: 't.string :email, index: true',
    expected: ['index on users (email) added, not concurrently'],
  },
  {
    written: 't.string :email, index: { unique: true }',
    expected: ['index on users (email) added, not concurrently'],
  },
  {
    written: 't.text :bio, :motto, index: true',
    expected: [
      'index on users (bio) added, not concurrently',
      'index on users (motto) added, not concurrently',
    ],
  },
  {
    written: 't.string :email, null: false, index: true',
    expected: [
      'column users.email added as null: false with no default',
      'index on users (email) added, not concurrently',
    ],
  },
  { written: 't.string :email, index: false', expected: [] },
  { written: 't.string :email, index: { algorithm: :concurrently }', expected: [] },
  {
    written: 't.column :email, :string, index: true',
    expected: ['index on users (email) added, not concurrently'],
  },
  { written: 't.column :email, :string', expected: [] },
  {
    written: 't.timestamps',
    expected: ['timestamps of users added as null: false with no default'],
  },
  { written: 't.timestamps null: true', expected: [] },
  { written: 't.index :email', expected: ['index on users (email) added, not concurrently'] },
  { written: 't.index :email, algorithm: :concurrently', expected: [] },
  { written: 'other.remove :name', expected: [] },
  { written: 'remove_column :orders, :state', expected: ['column orders.state removed'] },
])('in change_table, $written names the block table', ({ written, expected }) => {
  expect(railsMigrations.risks(inChangeTable(written)).map(({ title }) => title)).toStrictEqual(
    expected,
  );
});

test.for([
  { written: 't.index :email', expected: [] },
  { written: 't.string :email, null: false', expected: [] },
  { written: 't.references :account', expected: [] },
  { written: 't.string :email, index: true', expected: [] },
  { written: 't.remove :name', expected: ['column users.name removed'] },
])('change_table on a table created alongside: $written', ({ written, expected }) => {
  expect(
    railsMigrations
      .risks(
        migration(`create_table :users\n    change_table :users do |t|\n      ${written}\n    end`),
      )
      .map(({ title }) => title),
  ).toStrictEqual(expected);
});

test('a create_table block raises nothing of its own', () => {
  expect(
    titles(`create_table :users do |t|
      t.string :email, null: false
      t.index :email
      t.timestamps
    end`),
  ).toStrictEqual([]);
});

test.for([
  {
    reads: 'a change_table with no block parameter leaves bare calls bare',
    written: `change_table :users do
      remove_column :orders, :state
    end`,
    expected: ['column orders.state removed'],
  },
  {
    reads: 'a block of some other call is no change_table',
    written: `with_lock :users do |t|
      t.remove :name
    end`,
    expected: [],
  },
])('$reads', ({ written, expected }) => {
  expect(titles(written)).toStrictEqual(expected);
});

test('a file that does not parse throws, so it is reported rather than read as safe', () => {
  expect(() => railsMigrations.risks(migration('remove_column :users,'))).toThrow(
    'Ruby syntax error',
  );
});

test.for([
  { path: 'db/migrate/20260101000000_add_name.rb', holds: true },
  { path: 'apps/billing/db/migrate/20260101000000_add_name.rb', holds: true },
  { path: 'db/primary_migrate/20260101000000_add_name.rb', holds: true },
  { path: 'db/migrate/archive/20260101000000_add_name.rb', holds: true },
  { path: 'contest/db/migrate/20260101000000_add_name.rb', holds: true },
  { path: 'db/migrate/add_name.rb', holds: false },
  { path: 'db/migrate/20260101000000_add_name.sql', holds: false },
  { path: 'db/seeds/20260101000000_add_name.rb', holds: false },
  { path: 'mydb/migrate/20260101000000_add_name.rb', holds: false },
  { path: 'vendor/gem/db/migrate/20260101000000_add_name.rb', holds: false },
  { path: 'node_modules/gem/db/migrate/20260101000000_add_name.rb', holds: false },
  { path: 'test/dummy/db/migrate/20260101000000_add_name.rb', holds: false },
  { path: 'spec/dummy/db/migrate/20260101000000_add_name.rb', holds: false },
])('holds $path: $holds', ({ path, holds }) => {
  expect(railsMigrations.holds(path)).toBe(holds);
});
