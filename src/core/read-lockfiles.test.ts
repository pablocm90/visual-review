import { expect, test } from 'vitest';
import { readRange } from '../test-support/read-range.ts';
import { commit, gitRepo } from '../test-support/repos.ts';

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
