import type { FilePatch } from './diff-graphs.ts';
import { type Finding, isTestFile, placeOfFile } from './finding.ts';
import type { GraphNode } from './graph.ts';
import { lineIdOf, patchHunks } from './patch-lines.ts';
import type { SchemaReading } from './read-schemas.ts';
import type { RangeReading } from './reading.ts';
import type { NamedColumn, TableColumn } from './schema.ts';
import { literally } from './wildcard.ts';

type DeployColumnsOptions = {
  readonly schemas: ReadonlyArray<SchemaReading>;
  readonly patches: ReadonlyArray<FilePatch>;
  readonly namedAtHead: ReadonlyArray<NamedColumn>;
  readonly ignoredAtBase: ReadonlyArray<TableColumn>;
  readonly nodes: ReadonlyArray<GraphNode>;
};

const columnChanges = (schemas: ReadonlyArray<SchemaReading>) =>
  schemas.flatMap(reading =>
    'tables' in reading
      ? reading.tables
          .filter(table => table.state === 'changed')
          .flatMap(table =>
            table.columns.map(change => ({ file: reading.file, table: table.name, change })),
          )
      : [],
  );

const addedColumns = (schemas: ReadonlyArray<SchemaReading>) =>
  columnChanges(schemas).flatMap(({ table, change }) =>
    change.state === 'added' ? [{ table, column: change.head.name }] : [],
  );

export const removedColumns = (schemas: ReadonlyArray<SchemaReading>) =>
  columnChanges(schemas).flatMap(({ file, table, change }) =>
    change.state === 'removed' ? [{ file, table, column: change.base.name }] : [],
  );

/** The extensions of the files read as app code: Ruby, Rake and Ruby views. */
export const APP_CODE_EXTENSIONS = ['rb', 'rake', 'erb', 'jbuilder', 'slim', 'haml'];

const RUBY = new RegExp(String.raw`\.(?:${APP_CODE_EXTENSIONS.join('|')})$`);

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
  nodes,
}: Pick<DeployColumnsOptions, 'schemas' | 'namedAtHead' | 'nodes'>): ReadonlyArray<Finding> =>
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
            ...placeOfFile(nodes, named.path),
            title: `${named.path} still names the removed column ${table}.${column}`,
            detail:
              'Code running during the deploy may read it: ignore it in a deploy before dropping it. Matched by name.',
          },
        ];
  });

const notIgnoredFindings = ({
  schemas,
  ignoredAtBase,
}: Pick<DeployColumnsOptions, 'schemas' | 'ignoredAtBase'>): ReadonlyArray<Finding> =>
  removedColumns(schemas).flatMap(({ file, table, column }) =>
    ignoredAtBase.some(ignored => ignored.table === table && ignored.column === column)
      ? []
      : [
          {
            id: `deploy:not-ignored:${table}.${column}`,
            check: 'deploy:not-ignored',
            dimension: 'deploy',
            level: 'look',
            file,
            table,
            title: `${file} drops ${table}.${column}, which no model ignored at the base`,
            detail:
              'Code running the base during the deploy still loads it: ignore it in a deploy before dropping it. Matched by name.',
          },
        ],
  );

const usedFindings = ({
  schemas,
  patches,
}: Pick<DeployColumnsOptions, 'schemas' | 'patches'>): ReadonlyArray<Finding> =>
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
  ...notIgnoredFindings(options),
];

type ColumnsNotReadOptions = Pick<RangeReading, 'schemas' | 'migrations' | 'readers'>;

export const columnsNotRead = ({
  schemas,
  migrations,
  readers,
}: ColumnsNotReadOptions): ReadonlyArray<string> => {
  if (schemas.length > 0)
    return schemas.flatMap(reading =>
      'notRead' in reading ? [`columns: ${reading.file} not read`] : [],
    );
  if (migrations.length > 0) return ['columns: db/schema.rb only'];
  return readers.includes('rails') ? [] : ['columns: Rails only'];
};
