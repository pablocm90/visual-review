export type LockedPackages = {
  readonly versions: ReadonlyMap<string, ReadonlyArray<string>>;
  readonly direct: ReadonlySet<string>;
};

export type Lockfile = {
  readonly file: string;
  readonly ecosystem: string;
  readonly read: (sources: {
    readonly text: string;
    readonly manifests: ReadonlyArray<string>;
  }) => LockedPackages;
};

export const lockedVersions = (
  locked: ReadonlyArray<{ readonly name: string; readonly version: string }>,
): LockedPackages['versions'] =>
  new Map(
    [...Map.groupBy(locked, ({ name }) => name)].map(([name, copies]) => [
      name,
      [...new Set(copies.map(({ version }) => version))].toSorted((a, b) =>
        a.localeCompare(b, 'en', { numeric: true }),
      ),
    ]),
  );
