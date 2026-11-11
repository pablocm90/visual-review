import { counted } from './counted.ts';
import type { PackageChange } from './dependency-changes.ts';
import type { Finding } from './finding.ts';
import type { DependencyChanges } from './read-lockfiles.ts';

const versions = (list: ReadonlyArray<string>) => list.join(', ');

const titleOf = ({ name, change, from, to }: PackageChange): string => {
  if (change === 'added') return `${name} added at ${versions(to)}`;
  if (change === 'removed') return `${name} removed, was ${versions(from)}`;
  if (change === 'major') return `${name} ${versions(from)} → ${versions(to)}`;
  return `${name} ${versions(to)} ${change === 'now-direct' ? 'now direct' : 'no longer direct'}`;
};

const NAMED = 20;

const YARN_RULE =
  "direct read from package.json files at or under its folder, so a nested one that isn't a workspace counts too";

const KINDS = [
  ['added', 'added'],
  ['removed', 'removed'],
  ['major', 'major-bumped'],
] as const;

const rollUp = (
  lockfile: string,
  packages: ReadonlyArray<PackageChange>,
): ReadonlyArray<Finding> => {
  if (packages.length === 0) return [];
  const kinds = KINDS.flatMap(([change, word]) => {
    const count = packages.filter(found => found.change === change).length;
    return count === 0 ? [] : [`${count} ${word}`];
  });
  const named = packages.slice(0, NAMED).map(({ name }) => name);
  const rest = packages.length - named.length;
  return [
    {
      id: `dependencies:transitive:${lockfile}`,
      check: 'dependencies:transitive',
      dimension: 'dependencies',
      level: 'info',
      file: lockfile,
      title: `${counted(packages.length, 'transitive package', 'transitive packages')} changed in ${lockfile}: ${kinds.join(', ')}`,
      detail: [...named, ...(rest === 0 ? [] : [`and ${rest} more`])].join(', '),
    },
  ];
};

export const dependencyFindings = (
  changes: ReadonlyArray<DependencyChanges>,
): ReadonlyArray<Finding> =>
  changes.flatMap(change =>
    'notRead' in change
      ? [
          {
            id: `dependencies:not-read:${change.lockfile}`,
            check: 'dependencies:not-read',
            dimension: 'dependencies',
            level: 'look',
            file: change.lockfile,
            title: `${change.lockfile} not read: ${change.notRead}`,
          },
        ]
      : [
          ...change.packages
            .filter(found => found.direct)
            .map(
              (found): Finding => ({
                id: `dependencies:${change.lockfile}:${found.name}`,
                check: 'dependencies:direct',
                dimension: 'dependencies',
                level: 'look',
                file: change.lockfile,
                title: titleOf(found),
                detail: change.lockfile.endsWith('yarn.lock')
                  ? `${change.lockfile}: ${YARN_RULE}`
                  : change.lockfile,
              }),
            ),
          ...rollUp(
            change.lockfile,
            change.packages.filter(found => !found.direct),
          ),
        ],
  );
