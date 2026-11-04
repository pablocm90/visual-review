import { basename, dirname } from 'node:path';
import { type PackageChange, packageChanges } from './dependency-changes.ts';
import { git } from './git.ts';
import { type LockedPackages, type Lockfile, lockedVersions } from './lockfile.ts';

export type DependencyChanges =
  | {
      readonly lockfile: string;
      readonly ecosystem: string;
      readonly packages: ReadonlyArray<PackageChange>;
    }
  | { readonly lockfile: string; readonly notRead: string };

const SKIPPED = /(?:^|\/)(?:node_modules|vendor|tests?|spec|fixtures|__fixtures__)\//;

type LockfileAt = {
  readonly path: string;
  readonly lockfile: Lockfile;
};

type LockfileChange = {
  readonly name: string;
  readonly ecosystem: string;
  readonly before: LockfileAt | undefined;
  readonly after: LockfileAt | undefined;
};

type Reading = {
  readonly locked?: LockedPackages;
  readonly notRead?: string;
};

const readAt = async (
  repo: string,
  revision: string,
  { path, lockfile }: LockfileAt,
): Promise<LockedPackages | undefined> => {
  if ((await git(repo, 'ls-tree', '--name-only', revision, '--', path)) === '') return undefined;
  const show = (file: string) => git(repo, 'show', `${revision}:${file}`);
  const manifests = (
    await git(repo, 'ls-tree', '-r', '--name-only', revision, '--', `${dirname(path)}/`)
  )
    .split('\n')
    .filter(file => basename(file) === lockfile.manifest && !SKIPPED.test(file));
  return lockfile.read({
    text: (await show(path)).replaceAll('\r\n', '\n'),
    manifests: await Promise.all(manifests.map(show)),
  });
};

const readingAt = async (
  repo: string,
  revision: string,
  side: LockfileAt | undefined,
): Promise<Reading> => {
  if (side === undefined) return {};
  try {
    const locked = await readAt(repo, revision, side);
    return locked === undefined ? {} : { locked };
  } catch (error) {
    return { notRead: error instanceof Error ? error.message : String(error) };
  }
};

const merged = (readings: ReadonlyArray<Reading>): LockedPackages => {
  const sides = readings.flatMap(({ locked }) => (locked === undefined ? [] : [locked]));
  return {
    versions: lockedVersions(
      sides.flatMap(({ versions }) =>
        [...versions].flatMap(([name, copies]) => copies.map(version => ({ name, version }))),
      ),
    ),
    direct: new Set(sides.flatMap(({ direct }) => [...direct])),
  };
};

type Revisions = {
  readonly repo: string;
  readonly base: string;
  readonly head: string;
};

const changesOfGroup = async (
  { repo, base, head }: Revisions,
  group: ReadonlyArray<LockfileChange>,
): Promise<ReadonlyArray<DependencyChanges>> => {
  const readings = await Promise.all(
    group.map(async ({ name, ecosystem, before, after }) => ({
      name,
      ecosystem,
      before: await readingAt(repo, base, before),
      after: await readingAt(repo, head, after),
    })),
  );
  const failed = readings.flatMap(({ name, before, after }) => {
    const notRead = before.notRead ?? after.notRead;
    return notRead === undefined ? [] : [{ lockfile: name, notRead }];
  });
  if (failed.length > 0) return failed;
  const packages = packageChanges({
    before: merged(readings.map(({ before }) => before)),
    after: merged(readings.map(({ after }) => after)),
  });
  return [...readings.filter(({ after }) => after.locked !== undefined), ...readings]
    .slice(0, 1)
    .map(({ name, ecosystem }) => ({ lockfile: name, ecosystem, packages }));
};

type ReadLockfilesOptions = Revisions & {
  readonly changes: ReadonlyArray<ReadonlyArray<string>>;
  readonly lockfiles: ReadonlyArray<Lockfile>;
};

export const readLockfiles = async ({
  changes,
  lockfiles,
  ...revisions
}: ReadLockfilesOptions): Promise<ReadonlyArray<DependencyChanges>> => {
  const lockfileAt = (path: string): LockfileAt | undefined => {
    const lockfile = lockfiles.find(({ file }) => file === basename(path));
    return lockfile === undefined || SKIPPED.test(path) ? undefined : { path, lockfile };
  };
  const lockfileChanges = changes.flatMap(([from = '', to = from]): LockfileChange[] => {
    const before = lockfileAt(from);
    const after = lockfileAt(to);
    const read = after ?? before;
    return read === undefined
      ? []
      : [{ name: to, ecosystem: read.lockfile.ecosystem, before, after }];
  });
  const groups = Map.groupBy(
    lockfileChanges,
    ({ name, ecosystem }) => `${ecosystem} ${dirname(name)}`,
  );
  return (
    await Promise.all([...groups.values()].map(group => changesOfGroup(revisions, group)))
  ).flat();
};
