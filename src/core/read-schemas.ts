import { git } from './git.ts';
import type { SchemaReader } from './schema.ts';
import { diffTables, type TableChange } from './schema-diff.ts';

export type SchemaReading =
  | { readonly file: string; readonly tables: ReadonlyArray<TableChange> }
  | { readonly file: string; readonly whole: 'added' | 'removed'; readonly tableCount: number }
  | { readonly file: string; readonly notRead: string };

type ReadSchemasOptions = {
  readonly repo: string;
  readonly base: string;
  readonly head: string;
  readonly changes: ReadonlyArray<ReadonlyArray<string>>;
  readonly schemas: ReadonlyArray<SchemaReader>;
};

const wholeFile = (
  file: string,
  whole: 'added' | 'removed',
  tables: ReadonlyArray<unknown>,
): ReadonlyArray<SchemaReading> =>
  tables.length === 0 ? [] : [{ file, whole, tableCount: tables.length }];

type Sides = {
  readonly first: string;
  readonly last: string;
  readonly baseText: string | undefined;
  readonly headText: string | undefined;
  readonly reader: SchemaReader;
};

const comparison = ({
  first,
  last,
  baseText,
  headText,
  reader,
}: Sides): ReadonlyArray<SchemaReading> => {
  if (headText === undefined) return wholeFile(first, 'removed', reader.tables(baseText ?? ''));
  if (baseText === undefined) return wholeFile(last, 'added', reader.tables(headText));
  const tables = diffTables({ base: reader.tables(baseText), head: reader.tables(headText) });
  return tables.length === 0 ? [] : [{ file: last, tables }];
};

export const readSchemas = async ({
  repo,
  base,
  head,
  changes,
  schemas,
}: ReadSchemasOptions): Promise<ReadonlyArray<SchemaReading>> => {
  const textAt = async (revision: string, file: string): Promise<string | undefined> =>
    (await git(repo, '--literal-pathspecs', 'ls-tree', '--name-only', revision, '--', file)) === ''
      ? undefined
      : git(repo, 'show', `${revision}:${file}`);
  const compare = async (
    [first = '', last = first]: ReadonlyArray<string>,
    reader: SchemaReader,
  ): Promise<ReadonlyArray<SchemaReading>> =>
    comparison({
      first,
      last,
      baseText: reader.holds(first) ? await textAt(base, first) : undefined,
      headText: reader.holds(last) ? await textAt(head, last) : undefined,
      reader,
    });
  const readings = await Promise.all(
    changes.map(async paths => {
      const reader = schemas.find(({ holds }) => paths.some(holds));
      if (reader === undefined) return [];
      try {
        return await compare(paths, reader);
      } catch (error) {
        return [
          {
            file: paths.at(-1) ?? '',
            notRead: error instanceof Error ? error.message : String(error),
          },
        ];
      }
    }),
  );
  return readings.flat();
};
