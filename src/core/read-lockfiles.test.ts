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
