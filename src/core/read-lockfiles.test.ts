import { symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { readRange } from '../test-support/read-range.ts';
import { commit, git, gitRepo } from '../test-support/repos.ts';

const cargoLock = (serde: string) => `version = 4

[[package]]
name = "app"
version = "0.1.0"
dependencies = [
 "serde",
]

[[package]]
name = "serde"
version = "${serde}"
source = "registry+https://github.com/rust-lang/crates.io-index"
`;

test('a changed lockfile reads as the changes of its packages between the two sides', async () => {
  using workspace = gitRepo({ 'Cargo.lock': cargoLock('1.0.219') });
  const { repo, root } = workspace;
  const to = commit(repo, { 'Cargo.lock': cargoLock('2.0.1') });

  const { dependencyChanges } = await readRange({ repo, from: root, to });

  expect(dependencyChanges).toStrictEqual([
    {
      lockfile: 'Cargo.lock',
      ecosystem: 'cargo',
      packages: [
        { name: 'serde', change: 'major', direct: true, from: ['1.0.219'], to: ['2.0.1'] },
      ],
    },
  ]);
});

const gemfileLock = (rack: string) => `GEM
  remote: https://rubygems.org/
  specs:
    rack (${rack})

PLATFORMS
  ruby

DEPENDENCIES
  rack
`;

test('a lockfile with some or all of its lines ending in \\r\\n reads as it does with \\n', async () => {
  const headerOnly = (text: string) => text.replace('GEM\n', 'GEM\r\n');
  const everyLine = (text: string) => text.replaceAll('\n', '\r\n');
  using workspace = gitRepo({ 'Gemfile.lock': headerOnly(gemfileLock('2.2.0')) });
  const { repo, root } = workspace;
  const to = commit(repo, { 'Gemfile.lock': everyLine(gemfileLock('3.1.0')) });

  const { dependencyChanges } = await readRange({ repo, from: root, to });

  expect(dependencyChanges).toStrictEqual([
    {
      lockfile: 'Gemfile.lock',
      ecosystem: 'bundler',
      packages: [{ name: 'rack', change: 'major', direct: true, from: ['2.2.0'], to: ['3.1.0'] }],
    },
  ]);
});

test('a lockfile added whole reads as all its packages added, one removed whole as all removed', async () => {
  using workspace = gitRepo({ 'README.md': '' });
  const { repo, root } = workspace;
  const added = commit(repo, { 'Cargo.lock': cargoLock('1.0.219') });
  git(repo, 'rm', '--quiet', 'Cargo.lock');
  const removed = commit(repo, { 'README.md': 'no lockfile' });

  const addedRange = await readRange({ repo, from: root, to: added });
  const removedRange = await readRange({ repo, from: added, to: removed });

  expect(addedRange.dependencyChanges).toMatchObject([
    { packages: [{ name: 'serde', change: 'added', direct: true, from: [], to: ['1.0.219'] }] },
  ]);
  expect(removedRange.dependencyChanges).toMatchObject([
    { packages: [{ name: 'serde', change: 'removed', direct: true, from: ['1.0.219'], to: [] }] },
  ]);
});

test.for([
  {
    format: 'a broken Cargo.lock',
    file: 'Cargo.lock',
    text: 'SECRET not a lockfile\n',
    notRead: 'Cargo.lock format not recognised',
  },
  {
    format: 'Yarn 2+',
    file: 'yarn.lock',
    text: '__metadata:\n  version: 8\n\n"SECRET@npm:1.0.0":\n  version: 1.0.0\n',
    notRead: 'yarn.lock Yarn 2+ format',
  },
])(
  '$format is not read, its message says why, and the review stands',
  async ({ file, text, notRead }) => {
    using workspace = gitRepo({ 'README.md': '' });
    const { repo, root } = workspace;
    const to = commit(repo, { [file]: text });

    const range = await readRange({ repo, from: root, to });

    expect(range.dependencyChanges).toStrictEqual([{ lockfile: file, notRead }]);
    expect(range.changedPaths).toContain(file);
  },
);

test('a symlink named as a lockfile is not read through to what it points at', async () => {
  using workspace = gitRepo({ 'README.md': '', 'real.lock': cargoLock('1.0.219') });
  const { repo, root } = workspace;
  symlinkSync('real.lock', join(repo, 'Cargo.lock'));
  const to = commit(repo, { 'README.md': 'with a link' });

  const { dependencyChanges } = await readRange({ repo, from: root, to });

  expect(dependencyChanges).toStrictEqual([
    { lockfile: 'Cargo.lock', notRead: 'Cargo.lock format not recognised' },
  ]);
});
