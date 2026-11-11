import type { AccessReader } from './access.ts';
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
  'dependencyChanges' | 'migrations' | 'schemas' | 'routes' | 'access'
>;

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
  return {
    dependencyChanges: await readLockfiles({ ...revisions, lockfiles }),
    migrations: await readMigrations({ ...revisions, migrations }),
    schemas: await readSchemas({ ...revisions, schemas }),
    routes: routesRead,
    access: await readAccess({ ...revisions, routed: routesRead.length > 0, access, authorize }),
  };
};
