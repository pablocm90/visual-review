import type { Linker } from './core/linker.ts';
import type { Reader } from './core/reader.ts';
import { fetchAxumLinker } from './linkers/fetch-axum/linker.ts';
import { railsReader } from './readers/rails/reader.ts';
import { rustReader } from './readers/rust/reader.ts';
import { typeScriptReader } from './readers/typescript/reader.ts';

export const readers: ReadonlyArray<Reader> = [rustReader, typeScriptReader, railsReader];

export const linkers: ReadonlyArray<Linker> = [fetchAxumLinker];
