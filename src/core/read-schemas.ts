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
  ): Promise<ReadonlyArray<SchemaReading>> => {
    const baseText = reader.holds(first) ? await textAt(base, first) : undefined;
    const headText = reader.holds(last) ? await textAt(head, last) : undefined;
    if (headText === undefined) {
      const tableCount = reader.tables(baseText ?? '').length;
      return tableCount === 0 ? [] : [{ file: first, whole: 'removed', tableCount }];
    }
    if (baseText === undefined) {
      const tableCount = reader.tables(headText).length;
      return tableCount === 0 ? [] : [{ file: last, whole: 'added', tableCount }];
    }
    const tables = diffTables({ base: reader.tables(baseText), head: reader.tables(headText) });
    return tables.length === 0 ? [] : [{ file: last, tables }];
  };
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
