import type { RouteRow } from './read-routes.ts';
import type { Route } from './routes.ts';

export type RouteLine = { readonly verbs: string; readonly row: RouteRow };

export const routeOf = (row: RouteRow): Route => (row.state === 'removed' ? row.base : row.head);

export const lineKey = ({ verbs, row }: RouteLine): string => {
  const { root, path } = routeOf(row);
  return `${root} ${verbs} ${path}`;
};

const targetsOf = (row: RouteRow): string =>
  JSON.stringify(
    row.state === 'changed' ? [row.base.target, row.head.target] : [routeOf(row).target],
  );

const sameLine = (one: RouteRow, other: RouteRow): boolean =>
  one.state === other.state &&
  routeOf(one).root === routeOf(other).root &&
  routeOf(one).path === routeOf(other).path &&
  targetsOf(one) === targetsOf(other);

export const routeLines = (rows: ReadonlyArray<RouteRow>): ReadonlyArray<RouteLine> => {
  const hasTwin = (row: RouteRow, verb: string): boolean =>
    rows.some(other => routeOf(other).verb === verb && sameLine(other, row));
  return rows.flatMap((row): ReadonlyArray<RouteLine> => {
    const { verb } = routeOf(row);
    if (verb === 'PUT' && hasTwin(row, 'PATCH')) return [];
    return [{ verbs: verb === 'PATCH' && hasTwin(row, 'PUT') ? 'PATCH/PUT' : verb, row }];
  });
};
