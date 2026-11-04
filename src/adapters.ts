import type { Linker } from './core/linker.ts';
import type { Lockfile } from './core/lockfile.ts';
import type { Reader } from './core/reader.ts';
import { fetchAxumLinker } from './linkers/fetch-axum/linker.ts';
import { bundlerLockfile } from './lockfiles/bundler.ts';
import { cargoLockfile } from './lockfiles/cargo.ts';
import { npmLockfile } from './lockfiles/npm.ts';
import { pnpmLockfile } from './lockfiles/pnpm.ts';
import { yarnLockfile } from './lockfiles/yarn.ts';
import { railsReader } from './readers/rails/reader.ts';
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
