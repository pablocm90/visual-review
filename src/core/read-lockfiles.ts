import { basename } from 'node:path';
import { type PackageChange, packageChanges } from './dependency-changes.ts';
import { git } from './git.ts';
import type { Lockfile } from './lockfile.ts';

export type DependencyChanges = {
  readonly lockfile: string;
  readonly ecosystem: string;
  readonly packages: ReadonlyArray<PackageChange>;
};

type ReadLockfilesOptions = {
  readonly repo: string;
  readonly base: string;
  readonly head: string;
  readonly changes: ReadonlyArray<ReadonlyArray<string>>;
  readonly lockfiles: ReadonlyArray<Lockfile>;
};

export const readLockfiles = ({
  repo,
  base,
  head,
  changes,
  lockfiles,
}: ReadLockfilesOptions): Promise<ReadonlyArray<DependencyChanges>> =>
  Promise.all(
    changes.flat().flatMap(path => {
      const lockfile = lockfiles.find(({ file }) => file === basename(path));
      if (lockfile === undefined) return [];
      const readAt = async (revision: string) =>
        lockfile.read({ text: await git(repo, 'show', `${revision}:${path}`), manifests: [] });
      return [
        (async () => ({
          lockfile: path,
          ecosystem: lockfile.ecosystem,
          packages: packageChanges({ before: await readAt(base), after: await readAt(head) }),
        }))(),
      ];
    }),
  );
