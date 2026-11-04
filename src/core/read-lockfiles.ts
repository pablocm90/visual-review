import { basename } from 'node:path';
import { type PackageChange, packageChanges } from './dependency-changes.ts';
import { git } from './git.ts';
import type { LockedPackages, Lockfile } from './lockfile.ts';

export type DependencyChanges =
  | {
      readonly lockfile: string;
      readonly ecosystem: string;
      readonly packages: ReadonlyArray<PackageChange>;
    }
  | { readonly lockfile: string; readonly notRead: string };

const ABSENT: LockedPackages = { versions: new Map(), direct: new Set() };
const SKIPPED = /(?:^|\/)(?:node_modules|vendor|tests?|spec|fixtures|__fixtures__)\//;

type LockfileChangeOptions = {
  readonly repo: string;
  readonly base: string;
  readonly head: string;
  readonly path: string;
  readonly lockfile: Lockfile;
};

const lockfileChange = async ({
  repo,
  base,
  head,
  path,
  lockfile,
}: LockfileChangeOptions): Promise<DependencyChanges> => {
  const readAt = async (revision: string) => {
    if ((await git(repo, 'ls-tree', '--name-only', revision, '--', path)) === '') return ABSENT;
    const text = await git(repo, 'show', `${revision}:${path}`);
    return lockfile.read({ text: text.replaceAll('\r\n', '\n'), manifests: [] });
  };
  try {
    return {
      lockfile: path,
      ecosystem: lockfile.ecosystem,
      packages: packageChanges({ before: await readAt(base), after: await readAt(head) }),
    };
  } catch (error) {
    return { lockfile: path, notRead: error instanceof Error ? error.message : String(error) };
  }
};

type ReadLockfilesOptions = Omit<LockfileChangeOptions, 'path' | 'lockfile'> & {
  readonly changes: ReadonlyArray<ReadonlyArray<string>>;
  readonly lockfiles: ReadonlyArray<Lockfile>;
};

export const readLockfiles = ({
  changes,
  lockfiles,
  ...sides
}: ReadLockfilesOptions): Promise<ReadonlyArray<DependencyChanges>> =>
  Promise.all(
    changes.flat().flatMap(path => {
      const lockfile = lockfiles.find(({ file }) => file === basename(path));
      return lockfile === undefined || SKIPPED.test(path)
        ? []
        : [lockfileChange({ ...sides, path, lockfile })];
    }),
  );
