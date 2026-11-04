import type { LockedPackages } from './lockfile.ts';

export type PackageChange = {
  readonly name: string;
  readonly change: 'added' | 'removed' | 'major' | 'now-direct' | 'no-longer-direct';
  readonly direct: boolean;
  readonly from: ReadonlyArray<string>;
  readonly to: ReadonlyArray<string>;
};

type PackageChangesOptions = {
  readonly before: LockedPackages;
  readonly after: LockedPackages;
};

const lineOf = (version: string): string =>
  version.match(/^(?:0+\.)*(?:[1-9]\d*(?=[.+-])|0+(?=[+-]))/)?.[0] ?? version;

const linesOf = (versions: ReadonlyArray<string>): string =>
  [...new Set(versions.map(lineOf))].toSorted().join(' ');

const kindOf = (
  name: string,
  { before, after }: PackageChangesOptions,
): PackageChange['change'] | undefined => {
  const from = before.versions.get(name);
  const to = after.versions.get(name);
  if (from === undefined) return 'added';
  if (to === undefined) return 'removed';
  if (linesOf(from) !== linesOf(to)) return 'major';
  if (before.direct.has(name) === after.direct.has(name)) return undefined;
  return after.direct.has(name) ? 'now-direct' : 'no-longer-direct';
};

export const packageChanges = (sides: PackageChangesOptions): ReadonlyArray<PackageChange> => {
  const { before, after } = sides;
  const names = new Set([...before.versions.keys(), ...after.versions.keys()]);
  return [...names].toSorted().flatMap(name => {
    const change = kindOf(name, sides);
    return change === undefined
      ? []
      : [
          {
            name,
            change,
            direct: before.direct.has(name) || after.direct.has(name),
            from: before.versions.get(name) ?? [],
            to: after.versions.get(name) ?? [],
          },
        ];
  });
};
