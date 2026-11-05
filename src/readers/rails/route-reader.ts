import type { Node } from 'web-tree-sitter';
import type { Route, RouteReader } from '../../core/routes.ts';
import { argsOf, methodOf, nameOf, parseRuby } from './ruby-syntax.ts';

const ROUTES_FILE = /(?:^|\/)config\/routes\.rb$/;

const ACTIONS: ReadonlyArray<readonly [string, string, string]> = [
  ['GET', '', 'index'],
  ['POST', '', 'create'],
  ['GET', '/new', 'new'],
  ['GET', '/:id/edit', 'edit'],
  ['GET', '/:id', 'show'],
  ['PATCH', '/:id', 'update'],
  ['PUT', '/:id', 'update'],
  ['DELETE', '/:id', 'destroy'],
];

const statementsOf = (call: Node): ReadonlyArray<Node> =>
  (call.childForFieldName('block')?.childForFieldName('body')?.namedChildren ?? []).filter(
    ({ type }) => type !== 'comment',
  );

const routesIn = (file: string, statement: Node): ReadonlyArray<Route> => {
  const method = methodOf(statement);
  if (method === 'draw') return statementsOf(statement).flatMap(inner => routesIn(file, inner));
  if (method !== 'resources') return [];
  return argsOf(statement).flatMap(arg =>
    ACTIONS.map(([verb, suffix, action]) => ({
      verb,
      path: `/${nameOf(arg)}${suffix}`,
      target: `${nameOf(arg)}#${action}`,
      file,
      line: statement.startPosition.row + 1,
    })),
  );
};

export const railsRoutes: RouteReader = {
  holds: path => ROUTES_FILE.test(path),
  routes: files => ({
    routes: [...files].flatMap(([file, text]) => {
      const program = parseRuby(text);
      return (program?.namedChildren ?? []).flatMap(statement => routesIn(file, statement));
    }),
  }),
};
