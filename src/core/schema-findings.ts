import { counted, type Finding } from './findings.ts';
import type { SchemaReading } from './read-schemas.ts';
import type { SchemaChange, TableChange } from './schema-diff.ts';

const STATES = ['added', 'removed', 'changed'] as const;

const changesOfKind = (
  changes: ReadonlyArray<SchemaChange<unknown>>,
  one: string,
  many: string,
): ReadonlyArray<string> =>
  STATES.map(state => ({
    state,
    count: changes.filter(change => change.state === state).length,
  }))
    .filter(({ count }) => count > 0)
    .map(({ state, count }, at) =>
      at === 0 ? `${counted(count, one, many)} ${state}` : `${count} ${state}`,
    );

const titleOf = ({ name, state, options, columns, indexes }: TableChange): string => {
  if (state !== 'changed') {
    const held = [
      counted(columns.length, 'column', 'columns'),
      ...(indexes.length === 0 ? [] : [counted(indexes.length, 'index', 'indexes')]),
    ];
    return `${name} ${state}: ${held.join(', ')}`;
  }
  const changes = [
    ...changesOfKind(columns, 'column', 'columns'),
    ...changesOfKind(indexes, 'index', 'indexes'),
    ...(options.base === options.head ? [] : ['table options changed']),
  ];
  return `${name}: ${changes.join(', ')}`;
};

const tableFinding = (file: string, table: TableChange): Finding => ({
  id: `schema:${file}:${table.name}`,
  dimension: 'schema',
  level: table.state === 'removed' ? 'look' : 'info',
  file,
  table: table.name,
  title: titleOf(table),
  detail: file,
});

const findingsOfReading = (reading: SchemaReading): ReadonlyArray<Finding> => {
  const { file } = reading;
  if ('notRead' in reading)
    return [
      {
        id: `schema:not-read:${file}`,
        dimension: 'schema',
        level: 'look',
        file,
        title: `${file} not read: ${reading.notRead}`,
      },
    ];
  if ('whole' in reading)
    return [
      {
        id: `schema:${file}`,
        dimension: 'schema',
        level: 'info',
        file,
        title: `${file} ${reading.whole}, with ${counted(reading.tableCount, 'table', 'tables')}`,
      },
    ];
  return reading.tables.map(table => tableFinding(file, table));
};

export const schemaFindings = (readings: ReadonlyArray<SchemaReading>): ReadonlyArray<Finding> =>
  readings.flatMap(findingsOfReading);
