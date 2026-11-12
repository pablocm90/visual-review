import type { AccessReader } from './access.ts';
import { removedColumns } from './deploy-columns.ts';
import { git, noneFound } from './git.ts';
import type { Lockfile } from './lockfile.ts';
import type { MigrationReader } from './migration.ts';
import { readAccess } from './read-access.ts';
import { readLockfiles } from './read-lockfiles.ts';
import { readMigrations } from './read-migrations.ts';
import { readRoutes } from './read-routes.ts';
import { readSchemas } from './read-schemas.ts';
import type { RangeReading } from './reading.ts';
import type { RouteReader } from './routes.ts';
import type { SchemaReader } from './schema.ts';

/**
 * The ports that read a changed file alone, with no drawn stack: lockfiles, migrations, schema
 * dumps, routes and controllers' authorization. They aren't `Reader` methods because none needs a
 * stack read.
 */
export type ChangeReaders = {
  readonly lockfiles: ReadonlyArray<Lockfile>;
  readonly migrations: ReadonlyArray<MigrationReader>;
  readonly schemas: ReadonlyArray<SchemaReader>;
  readonly routes: ReadonlyArray<RouteReader>;
  readonly access: ReadonlyArray<AccessReader>;
};

type ReadChangesOptions = ChangeReaders & {
  readonly repo: string;
  readonly base: string;
  readonly head: string;
  readonly changes: ReadonlyArray<ReadonlyArray<string>>;
  /** The authorizing names, from the base's `security`. */
  readonly authorize: ReadonlyArray<string>;
};

export type ChangesRead = Pick<
  RangeReading,
  | 'dependencyChanges'
  | 'migrations'
  | 'schemas'
  | 'columnsNamedAtHead'
  | 'columnsIgnoredAtBase'
  | 'routes'
  | 'access'
>;

type NamedAt = {
  readonly repo: string;
  readonly revision: string;
  readonly names: ReadonlyArray<string>;
};

const namedAt = async ({ repo, revision, names }: NamedAt) => {
  if (names.length === 0) return [];
  const found = await git(
    repo,
    'grep',
    '-F',
    '-w',
    '-o',
    '-I',
    '-z',
    '--no-line-number',
    '--no-column',
    ...names.flatMap(name => ['-e', name]),
    revision,
    '--',
  ).catch(noneFound);
  const reads = found
    .split('\n')
    .filter(line => line !== '')
    .map(line => {
      const [path = '', column = ''] = line.slice(revision.length + 1).split('\0');
      return { path, column };
    });
  return reads.filter(
    (read, index) =>
      reads.findIndex(({ path, column }) => path === read.path && column === read.column) === index,
  );
};

type IgnoredAt = {
  readonly repo: string;
  readonly revision: string;
  readonly schemas: ReadonlyArray<SchemaReader>;
};

const ignoredAt = async ({ repo, revision, schemas }: IgnoredAt) => {
  const files = (
    await git(repo, 'grep', '-l', '-z', 'ignored_columns', revision, '--', '*.rb').catch(noneFound)
  )
    .split('\0')
    .filter(line => line !== '')
    .map(line => line.slice(revision.length + 1));
  const models = await Promise.all(
    files.map(async path => ({ path, text: await git(repo, 'show', `${revision}:${path}`) })),
  );
  return schemas.flatMap(({ ignored }) => models.flatMap(ignored));
};

/** What each change reader reads of the range, the routes first since a changed route reaches access. */
export const readChanges = async ({
  repo,
  base,
  head,
  changes,
  authorize,
  lockfiles,
  migrations,
  schemas,
  routes,
  access,
}: ReadChangesOptions): Promise<ChangesRead> => {
  const revisions = { repo, base, head, changes };
  const routesRead = await readRoutes({ ...revisions, routes });
  const schemasRead = await readSchemas({ ...revisions, schemas });
  return {
    dependencyChanges: await readLockfiles({ ...revisions, lockfiles }),
    migrations: await readMigrations({ ...revisions, migrations }),
    schemas: schemasRead,
    columnsNamedAtHead: await namedAt({
      repo,
      revision: head,
      names: removedColumns(schemasRead).map(({ column }) => column),
    }),
    columnsIgnoredAtBase: await ignoredAt({ repo, revision: base, schemas }),
    routes: routesRead,
    access: await readAccess({ ...revisions, routed: routesRead.length > 0, access, authorize }),
  };
};
