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
  readonly memberOf: (path: string, param: string) => string;
  readonly nestedOf: (path: string, name: string, param: string) => string;
};

const under = (base: string, name: string): string => {
  const segment = name.replace(/^\//, '');
  return segment === '' ? base : `${base}/${segment}`;
};

const writtenOr = (args: ReadonlyArray<Node>, key: string, fallback: string): string => {
  const option = optionOf(args, key);
  return option === undefined ? fallback : nameOf(option);
};

const inModule = (args: ReadonlyArray<Node>, module: string): string => {
  const option = optionOf(args, 'module');
  return option === undefined ? module : `${module}${nameOf(option)}/`;
};

const within = (call: Node, scope: Scope): ReadonlyArray<Route> =>
  statementsOf(call).flatMap(statement => routesIn(statement, scope));

const resourcesOf =
  ({ actions, controllerOf, memberOf, nestedOf }: Resourceful): Handler =>
  (call, scope) => {
    const args = argsOf(call);
    const param = writtenOr(args, 'param', 'id');
    const module = inModule(args, scope.module);
    return positional(args).flatMap(arg => {
      const name = nameOf(arg);
      const path = under(scope.path, writtenOr(args, 'path', name));
      const controller = writtenOr(args, 'controller', controllerOf(name));
      return [
        ...kept(actions, args).map(([verb, suffix, action]) => ({
          verb,
          path: `${path}${suffix.replace(':id', `:${param}`)}`,
          target: `${module}${controller}#${action}`,
          file: scope.file,
          line: call.startPosition.row + 1,
        })),
        ...within(call, {
          ...scope,
          module,
          path: nestedOf(path, name, param),
          controller,
          member: memberOf(path, param),
          collection: path,
        }),
      ];
    });
  };

const VIAS: ReadonlyMap<string, string> = new Map([['all', 'ANY']]);

const rooted: Handler = (call, scope) => {
  const args = argsOf(call);
  const to = toOf(args) ?? args[0];
  return [
    {
      verb: 'GET',
      path: scope.path,
      target: to?.type === 'string' ? `${scope.module}${nameOf(to)}` : (to?.text ?? ''),
      file: scope.file,
      line: call.startPosition.row + 1,
    },
  ];
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

const matched: Handler = (call, scope) => {
  const args = argsOf(call);
  return namesIn(optionOf(args, 'via')).flatMap(via =>
    drawnBy(VIAS.get(via) ?? via.toUpperCase())(call, scope),
  );
};

const mounted: Handler = (call, scope) => {
  const args = argsOf(call);
  const [first] = args;
  const pair = first?.type === 'pair' ? first : undefined;
  const path = pair?.childForFieldName('value') ?? optionOf(args, 'at');
  const app = pair?.childForFieldName('key') ?? first;
  return [
    {
      verb: 'ANY',
      path: under(scope.path, nameOf(path ?? undefined)),
      target: app?.text ?? '',
      file: scope.file,
      line: call.startPosition.row + 1,
    },
  ];
};

const namespace: Handler = (call, scope) => {
  const args = argsOf(call);
  const name = nameOf(args[0]);
  return within(call, {
    ...scope,
    path: under(scope.path, writtenOr(args, 'path', name)),
    module: `${scope.module}${writtenOr(args, 'module', name)}/`,
  });
};

const scoped: Handler = (call, scope) => {
  const args = argsOf(call);
  const named = positional(args);
  const written = named.length === 0 ? writtenOr(args, 'path', '') : named.map(nameOf).join('/');
  return within(call, {
    ...scope,
    path: written === '' ? scope.path : under(scope.path, written),
    module: inModule(args, scope.module),
    controller: writtenOr(args, 'controller', scope.controller),
  });
};

const HANDLERS: ReadonlyMap<string, Handler> = new Map<string, Handler>([
  ['draw', within],
  [
    'resources',
    resourcesOf({
      actions: RESOURCES_ACTIONS,
      controllerOf: name => name,
      memberOf: (path, param) => `${path}/:${param}`,
      nestedOf: (path, name, param) => `${path}/:${singular(name)}_${param}`,
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
  ['scope', scoped],
  ['root', rooted],
  ['match', matched],
  ['mount', mounted],
  ['constraints', within],
  ['defaults', within],
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

const START = { path: '', module: '', controller: '', member: '', collection: '' };

export const railsRoutes: RouteReader = {
  holds: path => ROUTES_FILE.test(path),
  routes: files => ({
    routes: [...files]
      .flatMap(([file, text]) =>
        (parseRuby(text)?.namedChildren ?? []).flatMap(statement =>
          routesIn(statement, { ...START, file }),
        ),
      )
      .map(route => ({ ...route, path: route.path === '' ? '/' : route.path })),
  }),
};
