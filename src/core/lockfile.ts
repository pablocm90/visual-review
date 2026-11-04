export type LockedPackages = {
  readonly versions: ReadonlyMap<string, ReadonlyArray<string>>;
  readonly direct: ReadonlySet<string>;
};
