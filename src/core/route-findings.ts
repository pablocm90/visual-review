import type { Finding } from './findings.ts';
import type { RouteRow, RoutesReading } from './read-routes.ts';
import { type RouteLine, routeLines } from './route-lines.ts';

const removalOrNewTarget = ({ verbs, row }: RouteLine): ReadonlyArray<Finding> => {
  if (row.state === 'added') return [];
  const { base, patch } = row;
  const line = `${verbs} ${base.path}`;
  return [
    {
      id: `routes:${row.state}:${base.root}:${line}`,
      dimension: 'routes',
      level: 'look',
      file: patch,
      title: row.state === 'removed' ? `${line} removed` : `${line} now goes to ${row.head.target}`,
      detail: `Was ${base.target}, at ${base.file}:${base.line}.`,
    },
  ];
};

const rowsOf = (readings: ReadonlyArray<RoutesReading>): ReadonlyArray<RouteRow> =>
  readings.flatMap(reading => ('notRead' in reading ? [] : reading.routes));

export const routeFindings = (readings: ReadonlyArray<RoutesReading>): ReadonlyArray<Finding> =>
  routeLines(rowsOf(readings)).flatMap(removalOrNewTarget);
