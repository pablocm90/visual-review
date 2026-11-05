import { git, gitUntrimmed } from './git.ts';
import type { MigrationReader, MigrationRisk } from './migration.ts';

export type MigrationReading =
  | { readonly file: string; readonly risks: ReadonlyArray<MigrationRisk> }
  | { readonly file: string; readonly notRead: string };

type ReadMigrationsOptions = {
  readonly repo: string;
  readonly base: string;
  readonly head: string;
  readonly changes: ReadonlyArray<ReadonlyArray<string>>;
  readonly migrations: ReadonlyArray<MigrationReader>;
};

const keepsItsVersion = (
  [from = '', to = '']: ReadonlyArray<string>,
  reader: MigrationReader,
): boolean => reader.holds(from) && reader.version(from) === reader.version(to);

export const readMigrations = async ({
  repo,
  base,
  head,
  changes,
  migrations,
}: ReadMigrationsOptions): Promise<ReadonlyArray<MigrationReading>> => {
  const atBase = async (file: string): Promise<boolean> =>
    (await git(repo, '--literal-pathspecs', 'ls-tree', '--name-only', base, '--', file)) !== '';
  const readingOf = async (file: string, reader: MigrationReader): Promise<MigrationReading> => {
    try {
      return { file, risks: reader.risks(await gitUntrimmed(repo, 'show', `${head}:${file}`)) };
    } catch (error) {
      return { file, notRead: error instanceof Error ? error.message : String(error) };
    }
  };
  const readings = await Promise.all(
    changes.map(async paths => {
      const file = paths.at(-1) ?? '';
      const reader = migrations.find(({ holds }) => holds(file));
      if (reader === undefined || keepsItsVersion(paths, reader)) return [];
      return (await atBase(file)) ? [] : [await readingOf(file, reader)];
    }),
  );
  return readings.flat();
};
