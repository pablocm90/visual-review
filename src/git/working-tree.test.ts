import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { cargoWorkspace, commit, crateFiles, git, writeFiles } from '../test-support/repos.ts';
import { snapshotWorkingTree } from './working-tree.ts';

test("a snapshot holds the working tree's untracked files and its edits over what is staged, but not its ignored files, and leaves the user's status and index as they were", async () => {
  using workspace = cargoWorkspace();
  const { repo } = workspace;
  const head = commit(repo, { '.gitignore': 'target/\n' });
  writeFiles(repo, {
    ...crateFiles('cli'),
    'crates/core/src/lib.rs': 'pub fn staged() {}\n',
    'target/debug.log': 'ignored',
  });
  git(repo, 'add', 'crates/core/src/lib.rs');
  writeFileSync(join(repo, 'crates/core/src/lib.rs'), 'pub fn edited() {}\n');
  const userState = () => ({
    status: git(repo, 'status', '--porcelain'),
    index: git(repo, 'diff', '--cached'),
  });
  const before = userState();

  const snapshot = await snapshotWorkingTree(repo);

  expect(git(repo, 'rev-parse', `${snapshot}^`)).toBe(head);
  expect(git(repo, 'ls-tree', '-r', '--name-only', snapshot).split('\n')).toEqual([
    '.gitignore',
    'Cargo.toml',
    'crates/cli/Cargo.toml',
    'crates/cli/src/lib.rs',
    'crates/core/Cargo.toml',
    'crates/core/src/lib.rs',
  ]);
  expect(git(repo, 'show', `${snapshot}:crates/core/src/lib.rs`)).toBe('pub fn edited() {}');
  expect(userState()).toEqual(before);
});
