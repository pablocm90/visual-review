import type { Node } from 'web-tree-sitter';
import type { Route, RouteReader } from '../../core/routes.ts';
import { plural, singular } from './inflection.ts';
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
  readonly controller: string;
  readonly member: string;
  readonly collection: string;
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

type Resourceful = {
  readonly actions: ReadonlyArray<Action>;
  readonly controllerOf: (name: string) => string;
  readonly memberOf: (path: string) => string;
  readonly nestedOf: (path: string, name: string) => string;
};

const within = (call: Node, scope: Scope): ReadonlyArray<Route> =>
  statementsOf(call).flatMap(statement => routesIn(statement, scope));

const resourcesOf =
  ({ actions, controllerOf, memberOf, nestedOf }: Resourceful): Handler =>
  (call, scope) => {
    const args = argsOf(call);
    return positional(args).flatMap(arg => {
      const name = nameOf(arg);
      const path = `${scope.path}/${name}`;
      const controller = controllerOf(name);
      return [
        ...kept(actions, args).map(([verb, suffix, action]) => ({
          verb,
          path: `${path}${suffix}`,
          target: `${scope.module}${controller}#${action}`,
          file: scope.file,
          line: call.startPosition.row + 1,
        })),
        ...within(call, {
          ...scope,
          path: nestedOf(path, name),
          controller,
          member: memberOf(path),
          collection: path,
        }),
      ];
    });
  };

const placedAt = (on: string | undefined, scope: Scope): string => {
  if (on === 'member') return scope.member;
  return on === 'collection' ? scope.collection : scope.path;
};

const SHORTHAND = /^\/?[-\w]+\/[-\w/]+$/;

const actionWord = (name: string): string => name.replaceAll('-', '_');

const pairedTo = (args: ReadonlyArray<Node>): Node | undefined =>
  args.find(arg => arg.type === 'pair' && arg.childForFieldName('key')?.type === 'string');

const toOf = (args: ReadonlyArray<Node>): Node | undefined =>
  optionOf(args, 'to') ?? pairedTo(args)?.childForFieldName('value') ?? undefined;

const shorthandFor = (name: string, args: ReadonlyArray<Node>): string | undefined =>
  toOf(args) === undefined && optionOf(args, 'controller') === undefined && SHORTHAND.test(name)
    ? actionWord(name.replace(/^\//, '').replace(/\/([^/]*)$/, '#$1'))
    : undefined;

const namedTarget = (name: string, args: ReadonlyArray<Node>, scope: Scope): string => {
  const to = toOf(args);
  const written = to === undefined ? undefined : nameOf(to);
  if (written?.includes('#')) return written;
  const action = optionOf(args, 'action');
  const controller = optionOf(args, 'controller');
  return `${controller === undefined ? scope.controller : nameOf(controller)}#${
    written ?? (action === undefined ? actionWord(name) : nameOf(action))
  }`;
};

const targetOf = (name: string, args: ReadonlyArray<Node>, scope: Scope): string => {
  const to = toOf(args);
  if (to !== undefined && to.type !== 'string') return to.text;
  return `${scope.module}${shorthandFor(name, args) ?? namedTarget(name, args, scope)}`;
};

const under = (base: string, name: string): string => `${base}/${name.replace(/^\//, '')}`;

const drawnBy =
  (verb: string): Handler =>
  (call, scope) => {
    const args = argsOf(call);
    const on = optionOf(args, 'on');
    const base = placedAt(on && nameOf(on), scope);
    const written = optionOf(args, 'path');
    const key = pairedTo(args)?.childForFieldName('key');
    return (key ? [key] : positional(args)).map(arg => ({
      verb,
      path: under(base, nameOf(written ?? arg)),
      target: targetOf(nameOf(arg), args, scope),
      file: scope.file,
      line: call.startPosition.row + 1,
    }));
  };

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
  [
    'resources',
    resourcesOf({
      actions: RESOURCES_ACTIONS,
      controllerOf: name => name,
      memberOf: path => `${path}/:id`,
      nestedOf: (path, name) => `${path}/:${singular(name)}_id`,
    }),
  ],
  [
    'resource',
    resourcesOf({
      actions: RESOURCE_ACTIONS,
      controllerOf: plural,
      memberOf: path => path,
      nestedOf: path => path,
    }),
  ],
  ['namespace', namespace],
  ['member', (call, scope) => within(call, { ...scope, path: scope.member })],
  ['collection', (call, scope) => within(call, { ...scope, path: scope.collection })],
  ['get', drawnBy('GET')],
  ['post', drawnBy('POST')],
  ['put', drawnBy('PUT')],
  ['patch', drawnBy('PATCH')],
  ['delete', drawnBy('DELETE')],
]);

const routesIn = (statement: Node, scope: Scope): ReadonlyArray<Route> =>
  HANDLERS.get(methodOf(statement))?.(statement, scope) ?? [];

export const railsRoutes: RouteReader = {
  holds: path => ROUTES_FILE.test(path),
  routes: files => ({
    routes: [...files].flatMap(([file, text]) => {
      const program = parseRuby(text);
      return (program?.namedChildren ?? []).flatMap(statement =>
        routesIn(statement, {
          file,
          path: '',
          module: '',
          controller: '',
          member: '',
          collection: '',
        }),
      );
    }),
  }),
};
