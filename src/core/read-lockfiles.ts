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

type LockfileAt = {
  readonly path: string;
  readonly lockfile: Lockfile;
};

type LockfileChangeOptions = {
  readonly repo: string;
  readonly base: string;
  readonly head: string;
  readonly name: string;
  readonly before: LockfileAt | undefined;
  readonly after: LockfileAt | undefined;
  readonly ecosystem: string;
};

const lockfileChange = async ({
  repo,
  base,
  head,
  name,
  before,
  after,
  ecosystem,
}: LockfileChangeOptions): Promise<DependencyChanges> => {
  const readAt = async (revision: string, side: LockfileAt | undefined) => {
    if (side === undefined) return ABSENT;
    const { path, lockfile } = side;
    if ((await git(repo, 'ls-tree', '--name-only', revision, '--', path)) === '') return ABSENT;
    const text = await git(repo, 'show', `${revision}:${path}`);
    return lockfile.read({ text: text.replaceAll('\r\n', '\n'), manifests: [] });
  };
  try {
    return {
      lockfile: name,
      ecosystem,
      packages: packageChanges({
        before: await readAt(base, before),
        after: await readAt(head, after),
      }),
    };
  } catch (error) {
    return { lockfile: name, notRead: error instanceof Error ? error.message : String(error) };
  }
};

type ReadLockfilesOptions = Pick<LockfileChangeOptions, 'repo' | 'base' | 'head'> & {
  readonly changes: ReadonlyArray<ReadonlyArray<string>>;
  readonly lockfiles: ReadonlyArray<Lockfile>;
};

export const readLockfiles = ({
  changes,
  lockfiles,
  ...sides
}: ReadLockfilesOptions): Promise<ReadonlyArray<DependencyChanges>> => {
  const lockfileAt = (path: string): LockfileAt | undefined => {
    const lockfile = lockfiles.find(({ file }) => file === basename(path));
    return lockfile === undefined || SKIPPED.test(path) ? undefined : { path, lockfile };
  };
  return Promise.all(
    changes.flatMap(([from = '', to = from]) => {
      const before = lockfileAt(from);
      const after = lockfileAt(to);
      const ecosystem = (after ?? before)?.lockfile.ecosystem;
      return ecosystem === undefined
        ? []
        : [lockfileChange({ ...sides, name: to, before, after, ecosystem })];
    }),
  );
};
