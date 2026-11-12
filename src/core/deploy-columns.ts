import type { FilePatch } from './diff-graphs.ts';
import type { Finding } from './finding.ts';
import { lineIdOf, patchHunks } from './patch-lines.ts';
import type { SchemaReading } from './read-schemas.ts';
import { isTestFile } from './secret-findings.ts';
import { literally } from './wildcard.ts';

type DeployColumnsOptions = {
  readonly schemas: ReadonlyArray<SchemaReading>;
  readonly patches: ReadonlyArray<FilePatch>;
  readonly namedAtHead: ReadonlyArray<{ readonly path: string; readonly column: string }>;
};

const columnChanges = (schemas: ReadonlyArray<SchemaReading>) =>
  schemas.flatMap(reading =>
    'tables' in reading
      ? reading.tables.flatMap(table =>
          table.columns.map(change => ({ table: table.name, change })),
        )
      : [],
  );

const addedColumns = (schemas: ReadonlyArray<SchemaReading>) =>
  columnChanges(schemas).flatMap(({ table, change }) =>
    change.state === 'added' ? [{ table, column: change.head.name }] : [],
  );

const removedColumns = (schemas: ReadonlyArray<SchemaReading>) =>
  columnChanges(schemas).flatMap(({ table, change }) =>
    change.state === 'removed' ? [{ table, column: change.base.name }] : [],
  );

const RUBY = /\.(?:rb|rake|erb)$/;

const MIGRATED = /(?:^|\/)db\//;

const isAppCode = (path: string): boolean =>
  RUBY.test(path) && !MIGRATED.test(path) && !isTestFile(path);

const firstRowNaming = (patches: ReadonlyArray<FilePatch>, column: string) => {
  const names = new RegExp(String.raw`\b${literally(column)}\b`);
  return patches
    .filter(({ path }) => isAppCode(path))
    .flatMap(({ path, patch }) =>
      patchHunks(patch)
        .flatMap(hunk => hunk.rows)
        .filter(row => row.kind === 'added' && names.test(row.code))
        .map(row => ({ path, line: lineIdOf(path, row) })),
    )
    .at(0);
};

const stillReadFindings = ({
  schemas,
  namedAtHead,
}: Omit<DeployColumnsOptions, 'patches'>): ReadonlyArray<Finding> =>
  removedColumns(schemas).flatMap(({ table, column }) => {
    const named = namedAtHead.find(read => read.column === column && isAppCode(read.path));
    return named === undefined
      ? []
      : [
          {
            id: `deploy:column-still-read:${table}.${column}`,
            check: 'deploy:column-still-read',
            dimension: 'deploy',
            level: 'look',
            file: named.path,
            title: `${named.path} still names the removed column ${table}.${column}`,
            detail:
              'Code running during the deploy may read it: ignore it in a deploy before dropping it. Matched by name.',
          },
        ];
  });

const usedFindings = ({
  schemas,
  patches,
}: Omit<DeployColumnsOptions, 'namedAtHead'>): ReadonlyArray<Finding> =>
  addedColumns(schemas).flatMap(({ table, column }) => {
    const named = firstRowNaming(patches, column);
    return named?.line === undefined
      ? []
      : [
          {
            id: `deploy:column-used:${table}.${column}`,
            check: 'deploy:column-used',
            dimension: 'deploy',
            level: 'info',
            file: named.path,
            line: named.line,
            title: `${named.path} names the new column ${table}.${column}`,
            detail:
              'On a rolling deploy this code can run before the migration: migrate first or guard it. Matched by name.',
          },
        ];
  });

export const deployColumnFindings = (options: DeployColumnsOptions): ReadonlyArray<Finding> => [
  ...usedFindings(options),
  ...stillReadFindings(options),
];
