import { expect, test } from 'vitest';
import { readRange } from '../test-support/read-range.ts';
import { commit, git, gitRepo } from '../test-support/repos.ts';

const FILE = 'db/migrate/20260101000000_strip_users.rb';

const migration = (body: string) => `class Strip < ActiveRecord::Migration[8.0]
  def change
    ${body}
  end
end
`;

const REMOVAL = {
  title: 'column users.name removed',
  why: 'Code still running during the deploy may read it.',
  line: 3,
};

test('an added migration is read for its risks', async () => {
  using workspace = gitRepo({ 'README.md': 'app' });
  const { repo, root } = workspace;
  const to = commit(repo, { [FILE]: migration('remove_column :users, :name') });

  const { migrations } = await readRange({ repo, from: root, to });

  expect(migrations).toStrictEqual([{ file: FILE, risks: [REMOVAL] }]);
});

test('a migration already at the base is not read, edited or deleted', async () => {
  const kept = 'db/migrate/20250101000000_keep.rb';
  using workspace = gitRepo({
    [FILE]: migration('remove_column :users, :name'),
    [kept]: migration('remove_column :users, :age'),
  });
  const { repo, root } = workspace;
  git(repo, 'rm', '-q', kept);
  const to = commit(repo, { [FILE]: migration('remove_column :users, :email') });

  const { migrations } = await readRange({ repo, from: root, to });

  expect(migrations).toStrictEqual([]);
});

test('a renamed migration counts as added: its version is new', async () => {
  const renamed = 'db/migrate/20260202000000_strip_users.rb';
  using workspace = gitRepo({ [FILE]: migration('remove_column :users, :name') });
  const { repo, root } = workspace;
  git(repo, 'mv', FILE, renamed);
  const to = commit(repo, { 'README.md': 'app' });

  const { migrations } = await readRange({ repo, from: root, to });

  expect(migrations).toStrictEqual([{ file: renamed, risks: [REMOVAL] }]);
});

test('a migration moved with its version kept has already run, so it is not read', async () => {
  const written = migration('remove_column :users, :name');
  using workspace = gitRepo({ [FILE]: written });
  const { repo, root } = workspace;
  git(repo, 'rm', '-q', FILE);
  const to = commit(repo, { 'db/primary_migrate/20260101000000_strip_all_users.rb': written });

  const { migrations } = await readRange({ repo, from: root, to });

  expect(migrations).toStrictEqual([]);
});

test('a file that was no migration, moved in with its number kept, is read', async () => {
  const vendored = 'vendor/db/migrate/20260101000000_strip_users.rb';
  const written = migration('remove_column :users, :name');
  using workspace = gitRepo({ [vendored]: written });
  const { repo, root } = workspace;
  git(repo, 'rm', '-q', vendored);
  const to = commit(repo, { [FILE]: written });

  const { migrations } = await readRange({ repo, from: root, to });

  expect(migrations).toStrictEqual([{ file: FILE, risks: [REMOVAL] }]);
});

test('a risk names its line in the file, past any blank lines leading it', async () => {
  using workspace = gitRepo({ 'README.md': 'app' });
  const { repo, root } = workspace;
  const to = commit(repo, { [FILE]: `\n\n${migration('remove_column :users, :name')}` });

  const { migrations } = await readRange({ repo, from: root, to });

  expect(migrations).toStrictEqual([{ file: FILE, risks: [{ ...REMOVAL, line: 5 }] }]);
});

test('an added file that is no migration is not read', async () => {
  using workspace = gitRepo({ 'README.md': 'app' });
  const { repo, root } = workspace;
  const to = commit(repo, { 'app/models/user.rb': migration('remove_column :users, :name') });

  const { migrations } = await readRange({ repo, from: root, to });

  expect(migrations).toStrictEqual([]);
});

test('a migration that does not parse is kept as not read', async () => {
  using workspace = gitRepo({ 'README.md': 'app' });
  const { repo, root } = workspace;
  const to = commit(repo, { [FILE]: migration('remove_column :users,') });

  const { migrations } = await readRange({ repo, from: root, to });

  expect(migrations).toStrictEqual([{ file: FILE, notRead: 'Ruby syntax error' }]);
});
