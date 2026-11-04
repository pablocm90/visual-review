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
