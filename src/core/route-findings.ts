import { counted } from './counted.ts';
import { countedId } from './counted-id.ts';
import type { Finding } from './finding.ts';
import type { RoutesReading, UnreadRow } from './read-routes.ts';
import { keyedStatements, lineKey, type RouteLine, routeLines } from './route-lines.ts';

const removalOrNewTarget = (routeLine: RouteLine): ReadonlyArray<Finding> => {
  const { verbs, row } = routeLine;
  if (row.state === 'added') return [];
  const { base, patch } = row;
  const line = `${verbs} ${base.path}`;
  return [
    {
      id: `routes:${row.state}:${base.root}:${line}`,
      check: `routes:${row.state}`,
      dimension: 'routes',
      level: 'look',
      file: patch,
      route: lineKey(routeLine),
      title: row.state === 'removed' ? `${line} removed` : `${line} now goes to ${row.head.target}`,
      detail: `Was ${base.target}, at ${base.file}:${base.line}.`,
    },
  ];
};

const addedPerFile = (lines: ReadonlyArray<RouteLine>): ReadonlyArray<Finding> =>
  [
    ...Map.groupBy(
      lines.filter(({ row }) => row.state === 'added'),
      ({ row }) => row.patch,
    ),
  ].map(([file, added]) => ({
    id: `routes:added:${file}`,
    check: 'routes:added',
    dimension: 'routes',
    level: 'info',
    file,
    title: `${counted(added.length, 'route', 'routes')} added in ${file}`,
  }));

const LONGEST_SHOWN = 60;

const shortened = (text: string): string =>
  text.length > LONGEST_SHOWN ? `${text.slice(0, LONGEST_SHOWN)}…` : text;

const STATE_WORDS = { added: 'Added', removed: 'Removed' } as const;

const unreadFindings = (rows: ReadonlyArray<UnreadRow>): ReadonlyArray<Finding> =>
  keyedStatements(rows).map(
    (
      {
        key,
        row: {
          state,
          item: { text, file, line },
          patch,
        },
      },
      at,
    ) => ({
      id: countedId(
        `routes:not-read:${file}:${text}`,
        rows.slice(0, at).filter(({ item }) => item.file === file && item.text === text).length,
      ),
      check: 'routes:not-read',
      dimension: 'routes',
      level: 'look',
      file: patch,
      route: key,
      title: `${STATE_WORDS[state]}, not read: ${shortened(text)}`,
      detail: `${text}, at ${file}:${line}. Routes it draws aren't compared.`,
    }),
  );

const findingsOfReading = (reading: RoutesReading): ReadonlyArray<Finding> => {
  if ('notRead' in reading)
    return [
      {
        id: `routes:not-read:${reading.file}`,
        check: 'routes:not-read',
        dimension: 'routes',
        level: 'look',
        file: reading.file,
        title: `${reading.file} not read: ${reading.notRead}`,
      },
    ];
  const lines = routeLines(reading.routes);
  return [
    ...lines.flatMap(removalOrNewTarget),
    ...addedPerFile(lines),
    ...unreadFindings(reading.unread),
  ];
};

export const routeFindings = (readings: ReadonlyArray<RoutesReading>): ReadonlyArray<Finding> =>
  readings.flatMap(findingsOfReading);
