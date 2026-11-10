import type { AccessReader } from './core/access.ts';
import type { Linker } from './core/linker.ts';
import type { Lockfile } from './core/lockfile.ts';
import type { MigrationReader } from './core/migration.ts';
import type { Reader } from './core/reader.ts';
import type { RouteReader } from './core/routes.ts';
import type { SchemaReader } from './core/schema.ts';
import { fetchAxumLinker } from './linkers/fetch-axum/linker.ts';
import { bundlerLockfile } from './lockfiles/bundler.ts';
import { cargoLockfile } from './lockfiles/cargo.ts';
import { npmLockfile } from './lockfiles/npm.ts';
import { pnpmLockfile } from './lockfiles/pnpm.ts';
import { yarnLockfile } from './lockfiles/yarn.ts';
import { railsAccess } from './readers/rails/access-reader.ts';
import { railsMigrations } from './readers/rails/migration-risks.ts';
import { railsReader } from './readers/rails/reader.ts';
import { railsRoutes } from './readers/rails/route-reader.ts';
import { railsSchema } from './readers/rails/schema-tables.ts';
import { rustReader } from './readers/rust/reader.ts';
import { typeScriptReader } from './readers/typescript/reader.ts';

export const readers: ReadonlyArray<Reader> = [rustReader, typeScriptReader, railsReader];

export const linkers: ReadonlyArray<Linker> = [fetchAxumLinker];

export const lockfiles: ReadonlyArray<Lockfile> = [
  cargoLockfile,
  bundlerLockfile,
  pnpmLockfile,
  npmLockfile,
  yarnLockfile,
];

export const migrations: ReadonlyArray<MigrationReader> = [railsMigrations];

export const schemas: ReadonlyArray<SchemaReader> = [railsSchema];

export const routes: ReadonlyArray<RouteReader> = [railsRoutes];

export const access: ReadonlyArray<AccessReader> = [railsAccess];
