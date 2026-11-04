export type MigrationRisk = {
  readonly title: string;
  readonly why: string;
  readonly line: number;
};

export type MigrationReader = {
  readonly holds: (path: string) => boolean;
  readonly risks: (text: string) => ReadonlyArray<MigrationRisk>;
};
