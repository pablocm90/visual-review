import type { PackageChange } from './dependency-changes.ts';
import type { Finding } from './findings.ts';
import type { DependencyChanges } from './read-lockfiles.ts';

const versions = (list: ReadonlyArray<string>) => list.join(', ');

const titleOf = ({ name, change, from, to }: PackageChange): string => {
  if (change === 'added') return `${name} added at ${versions(to)}`;
  if (change === 'removed') return `${name} removed, was ${versions(from)}`;
  if (change === 'major') return `${name} ${versions(from)} → ${versions(to)}`;
  return `${name} ${versions(to)} ${change === 'now-direct' ? 'now direct' : 'no longer direct'}`;
};

export const dependencyFindings = (
  changes: ReadonlyArray<DependencyChanges>,
): ReadonlyArray<Finding> =>
  changes.flatMap(change =>
    'notRead' in change
      ? []
      : change.packages.map(
          (found): Finding => ({
            id: `dependencies:${change.lockfile}:${found.name}`,
            dimension: 'dependencies',
            level: 'look',
            file: change.lockfile,
            title: titleOf(found),
            detail: change.lockfile,
          }),
        ),
  );
