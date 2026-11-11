import type { ChangeReaders } from './core/read-changes.ts';
import type { Adapters } from './core/read-stacks.ts';
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

/**
 * Every adapter `readRange` takes but `onPath`, which the caller gives: the stack readers and
 * linkers, and the change readers. A new one is added here and nowhere else.
 */
export const adapters: Omit<Adapters, 'onPath'> & ChangeReaders = {
  readers: [rustReader, typeScriptReader, railsReader],
  linkers: [fetchAxumLinker],
  lockfiles: [cargoLockfile, bundlerLockfile, pnpmLockfile, npmLockfile, yarnLockfile],
  migrations: [railsMigrations],
  schemas: [railsSchema],
  routes: [railsRoutes],
  access: [railsAccess],
};
