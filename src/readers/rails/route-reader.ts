import type { Node } from 'web-tree-sitter';
import type { Route, RouteReader } from '../../core/routes.ts';
import { plural } from './inflection.ts';
import {
  argsOf,
  methodOf,
  nameOf,
  namesIn,
  optionOf,
  parseRuby,
  positional,
} from './ruby-syntax.ts';

const ROUTES_FILE = /(?:^|\/)config\/routes\.rb$/;

type Action = readonly [verb: string, suffix: string, action: string];

const RESOURCES_ACTIONS: ReadonlyArray<Action> = [
  ['GET', '', 'index'],
  ['POST', '', 'create'],
  ['GET', '/new', 'new'],
  ['GET', '/:id/edit', 'edit'],
  ['GET', '/:id', 'show'],
  ['PATCH', '/:id', 'update'],
  ['PUT', '/:id', 'update'],
  ['DELETE', '/:id', 'destroy'],
];

const RESOURCE_ACTIONS: ReadonlyArray<Action> = [
  ['POST', '', 'create'],
  ['GET', '/new', 'new'],
  ['GET', '/edit', 'edit'],
  ['GET', '', 'show'],
  ['PATCH', '', 'update'],
  ['PUT', '', 'update'],
  ['DELETE', '', 'destroy'],
];

type Scope = {
  readonly file: string;
  readonly path: string;
  readonly module: string;
};

type Handler = (call: Node, scope: Scope) => ReadonlyArray<Route>;

const statementsOf = (call: Node): ReadonlyArray<Node> =>
  (call.childForFieldName('block')?.childForFieldName('body')?.namedChildren ?? []).filter(
    ({ type }) => type !== 'comment',
  );

const kept = (actions: ReadonlyArray<Action>, args: ReadonlyArray<Node>): ReadonlyArray<Action> => {
  const only = optionOf(args, 'only');
  const except = optionOf(args, 'except');
  return actions.filter(([, , action]) =>
    only === undefined
      ? !(except !== undefined && namesIn(except).includes(action))
      : namesIn(only).includes(action),
  );
};

const resourcesOf =
  (actions: ReadonlyArray<Action>, controllerOf: (name: string) => string): Handler =>
  (call, { file, path, module }) => {
    const args = argsOf(call);
    return positional(args).flatMap(arg =>
      kept(actions, args).map(([verb, suffix, action]) => ({
        verb,
        path: `${path}/${nameOf(arg)}${suffix}`,
        target: `${module}${controllerOf(nameOf(arg))}#${action}`,
        file,
        line: call.startPosition.row + 1,
      })),
    );
  };

const within = (call: Node, scope: Scope): ReadonlyArray<Route> =>
  statementsOf(call).flatMap(statement => routesIn(statement, scope));

const namespace: Handler = (call, scope) => {
  const name = nameOf(argsOf(call)[0]);
  return within(call, {
    ...scope,
    path: `${scope.path}/${name}`,
    module: `${scope.module}${name}/`,
  });
};

const HANDLERS: ReadonlyMap<string, Handler> = new Map<string, Handler>([
  ['draw', within],
  ['resources', resourcesOf(RESOURCES_ACTIONS, name => name)],
  ['resource', resourcesOf(RESOURCE_ACTIONS, plural)],
  ['namespace', namespace],
]);

const routesIn = (statement: Node, scope: Scope): ReadonlyArray<Route> =>
  HANDLERS.get(methodOf(statement))?.(statement, scope) ?? [];

export const railsRoutes: RouteReader = {
  holds: path => ROUTES_FILE.test(path),
  routes: files => ({
    routes: [...files].flatMap(([file, text]) => {
      const program = parseRuby(text);
      return (program?.namedChildren ?? []).flatMap(statement =>
        routesIn(statement, { file, path: '', module: '' }),
      );
    }),
  }),
};
