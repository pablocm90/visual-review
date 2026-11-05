import type { Node } from 'web-tree-sitter';
import type { Route, RouteReader, UnreadRoute } from '../../core/routes.ts';
import { plural, singular } from './inflection.ts';
import { NOT_SEARCHED } from './reader.ts';
import {
  argsOf,
  isNameList,
  methodOf,
  nameOf,
  namesIn,
  optionOf,
  parseRuby,
  positional,
  writtenIn,
} from './ruby-syntax.ts';

const ROOT_FILE = /(^|.*\/)config\/routes\.rb$/;

const ROUTES_FILE = /(?:^|\/)config\/routes(?:\/.*)?(?:\.rb)$/;

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

const MOST_STATEMENTS = 10_000;

type Scope = {
  readonly budget: { left: number };
  readonly files: ReadonlyMap<string, string>;
  readonly root: string;
  readonly loading: ReadonlyArray<string>;
  readonly file: string;
  readonly path: string;
  readonly module: string;
  readonly controller: string;
  readonly member: string;
  readonly collection: string;
};

type Drawn = Route | UnreadRoute;

type Handler = (call: Node, scope: Scope) => ReadonlyArray<Drawn>;

const placeOf = (statement: Node, { root, file }: Scope) => ({
  root,
  file,
  line: statement.startPosition.row + 1,
});

const unread = (statement: Node, scope: Scope): UnreadRoute => ({
  text: statement.text.replace(/\s+/g, ' '),
  path: scope.path,
  module: scope.module,
  ...placeOf(statement, scope),
});

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

const inModuleOf = (module: string, written: string): string =>
  written.startsWith('/') ? written.slice(1) : `${module}${written}`;

const writtenOr = (args: ReadonlyArray<Node>, key: string, fallback: string): string => {
  const option = optionOf(args, key);
  return option === undefined ? fallback : nameOf(option);
};

const inModule = (args: ReadonlyArray<Node>, module: string): string => {
  const option = optionOf(args, 'module');
  return option === undefined ? module : `${module}${nameOf(option)}/`;
};

const within = (call: Node, scope: Scope): ReadonlyArray<Drawn> =>
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
          target: inModuleOf(module, writtenOr(args, 'to', `${controller}#${action}`)),
          ...placeOf(call, scope),
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
  if (to === undefined) return [unread(call, scope)];
  return [
    {
      verb: 'GET',
      path: scope.path,
      target: to.type === 'string' ? inModuleOf(scope.module, nameOf(to)) : to.text,
      ...placeOf(call, scope),
    },
  ];
};

const placedAt = (on: string | undefined, scope: Scope): string => {
  if (on === 'member') return scope.member;
  return on === 'collection' ? scope.collection : scope.path;
};

const TWO_PART_PATH = /^\/?[-\w]+\/[-\w/]+$/;

const underscored = (name: string): string => name.replaceAll('-', '_');

const pairedTo = (args: ReadonlyArray<Node>): Node | undefined =>
  args.find(arg => arg.type === 'pair' && arg.childForFieldName('key')?.type === 'string');

const toOf = (args: ReadonlyArray<Node>): Node | undefined =>
  optionOf(args, 'to') ?? pairedTo(args)?.childForFieldName('value') ?? undefined;

const twoPartTarget = (name: string, args: ReadonlyArray<Node>): string | undefined =>
  toOf(args) === undefined && optionOf(args, 'action') === undefined && TWO_PART_PATH.test(name)
    ? underscored(name.replace(/^\//, '').replace(/\/([^/]*)$/, '#$1'))
    : undefined;

const PLAIN_NAME = /^[-\w]+$/;

const actionOf = (name: string, args: ReadonlyArray<Node>): string | undefined => {
  const to = toOf(args);
  if (to !== undefined) return nameOf(to);
  const action = optionOf(args, 'action');
  if (action !== undefined) return nameOf(action);
  return PLAIN_NAME.test(name) ? underscored(name) : undefined;
};

const namedTarget = (name: string, args: ReadonlyArray<Node>, scope: Scope): string | undefined => {
  const to = toOf(args);
  if (to !== undefined && nameOf(to).includes('#')) return nameOf(to);
  const controller = writtenOr(args, 'controller', scope.controller);
  const action = actionOf(name, args);
  return controller === '' || action === undefined ? undefined : `${controller}#${action}`;
};

const targetOf = (name: string, args: ReadonlyArray<Node>, scope: Scope): string | undefined => {
  const to = toOf(args);
  if (to !== undefined && to.type !== 'string') return to.text;
  const target = twoPartTarget(name, args) ?? namedTarget(name, args, scope);
  return target === undefined ? undefined : inModuleOf(scope.module, target);
};

const drawnBy =
  (verb: string): Handler =>
  (call, scope) => {
    const args = argsOf(call);
    const on = optionOf(args, 'on');
    const base = placedAt(on && nameOf(on), scope);
    const written = optionOf(args, 'path');
    const key = pairedTo(args)?.childForFieldName('key');
    return (key ? [key] : positional(args)).map(arg => {
      const target = targetOf(nameOf(arg), args, scope);
      return target === undefined
        ? unread(call, scope)
        : {
            verb,
            path: under(base, nameOf(written ?? arg)),
            target,
            ...placeOf(call, scope),
          };
    });
  };

const matched: Handler = (call, scope) => {
  const via = optionOf(argsOf(call), 'via');
  return via === undefined
    ? [unread(call, scope)]
    : namesIn(via).flatMap(verb => drawnBy(VIAS.get(verb) ?? verb.toUpperCase())(call, scope));
};

const isSplat = ({ type }: Node): boolean => type === 'hash_splat_argument';

const pairOf = ([first]: ReadonlyArray<Node>): Node | undefined =>
  first?.type === 'pair' ? first : undefined;

const isFixedMount = (args: ReadonlyArray<Node>, path: Node | undefined): path is Node =>
  path !== undefined && isName(path) && optionOf(args, 'via') === undefined && !args.some(isSplat);

const mounted: Handler = (call, scope) => {
  const args = argsOf(call);
  const pair = pairOf(args);
  const path = pair?.childForFieldName('value') ?? optionOf(args, 'at');
  const app = pair?.childForFieldName('key') ?? args[0];
  if (app === undefined || !isFixedMount(args, path)) return [unread(call, scope)];
  return [
    {
      verb: 'ANY',
      path: under(scope.path, nameOf(path)),
      target: app.text,
      ...placeOf(call, scope),
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
    path: under(scope.path, written),
    module: inModule(args, scope.module),
    controller: writtenOr(args, 'controller', scope.controller),
  });
};

const NAMES_ONLY: ReadonlySet<string> = new Set([
  'simple_symbol',
  'bare_symbol',
  'bare_string',
  'string',
]);

const isName = (node: Node): boolean =>
  NAMES_ONLY.has(node.type) && !node.namedChildren.some(({ type }) => type === 'interpolation');

const isNames = (node: Node): boolean =>
  isName(node) || (isNameList(node) && writtenIn(node).every(isName));

const NAMING_OPTIONS = ['only', 'except', 'path', 'controller', 'param', 'module', 'action', 'via'];

const REWRITING_OPTIONS = ['shallow', 'shallow_path', 'shallow_prefix', 'concerns', 'path_names'];

const PLACES: ReadonlySet<string> = new Set(['member', 'collection']);

const namesWhatItDraws = (args: ReadonlyArray<Node>): boolean => {
  const to = toOf(args);
  const on = optionOf(args, 'on');
  return (
    !args.some(isSplat) &&
    positional(args).every(isName) &&
    NAMING_OPTIONS.every(key => {
      const option = optionOf(args, key);
      return option === undefined || isNames(option);
    }) &&
    REWRITING_OPTIONS.every(key => optionOf(args, key) === undefined) &&
    (on === undefined || PLACES.has(nameOf(on))) &&
    (to === undefined || to.type !== 'string' || isName(to))
  );
};

const checked =
  (handler: Handler): Handler =>
  (call, scope) =>
    namesWhatItDraws(argsOf(call)) ? handler(call, scope) : [unread(call, scope)];

const isDraw = (statement: Node): boolean =>
  methodOf(statement) === 'draw' && statement.childForFieldName('block') !== null;

const programOf = (text: string): Node => {
  const program = parseRuby(text);
  if (program === undefined || program.hasError) throw new Error('Ruby syntax error');
  return program;
};

const drawnFrom = (file: string, scope: Scope): ReadonlyArray<Drawn> => {
  const statements = writtenIn(programOf(scope.files.get(file) ?? ''));
  const draws = statements.filter(isDraw);
  return (draws.length === 0 ? statements : draws).flatMap(statement =>
    routesIn(statement, { ...scope, file, loading: [...scope.loading, file] }),
  );
};

const follows =
  (pathOf: (args: ReadonlyArray<Node>) => string | undefined): Handler =>
  (call, scope) => {
    const path = pathOf(argsOf(call));
    const file = `${scope.root}${path}`;
    return path === undefined || !scope.files.has(file) || scope.loading.includes(file)
      ? [unread(call, scope)]
      : drawnFrom(file, scope);
  };

const drawnFile = ([name]: ReadonlyArray<Node>): string | undefined =>
  name !== undefined && isName(name) ? `config/routes/${nameOf(name)}.rb` : undefined;

const loadedFile = ([path]: ReadonlyArray<Node>): string | undefined => {
  if (path?.type !== 'call' || !path.text.startsWith('Rails.root.join')) return undefined;
  const parts = argsOf(path);
  return parts.every(isName) ? parts.map(nameOf).join('/') : undefined;
};

const drawOrFollow: Handler = (call, scope) =>
  isDraw(call) ? within(call, scope) : follows(drawnFile)(call, scope);

const HANDLERS: ReadonlyMap<string, Handler> = new Map<string, Handler>([
  ['draw', drawOrFollow],
  ['load', follows(loadedFile)],
  [
    'resources',
    checked(
      resourcesOf({
        actions: RESOURCES_ACTIONS,
        controllerOf: name => name,
        memberOf: (path, param) => `${path}/:${param}`,
        nestedOf: (path, name, param) => `${path}/:${singular(name)}_${param}`,
      }),
    ),
  ],
  [
    'resource',
    checked(
      resourcesOf({
        actions: RESOURCE_ACTIONS,
        controllerOf: plural,
        memberOf: path => path,
        nestedOf: path => path,
      }),
    ),
  ],
  ['namespace', checked(namespace)],
  ['scope', checked(scoped)],
  ['root', checked(rooted)],
  ['match', checked(matched)],
  ['mount', mounted],
  ['constraints', within],
  ['defaults', within],
  ['member', (call, scope) => within(call, { ...scope, path: scope.member })],
  ['collection', (call, scope) => within(call, { ...scope, path: scope.collection })],
  ['get', checked(drawnBy('GET'))],
  ['post', checked(drawnBy('POST'))],
  ['put', checked(drawnBy('PUT'))],
  ['patch', checked(drawnBy('PATCH'))],
  ['delete', checked(drawnBy('DELETE'))],
]);

const routesIn = (statement: Node, scope: Scope): ReadonlyArray<Drawn> => {
  scope.budget.left -= 1;
  if (scope.budget.left < 0) throw new Error('Too many routes to read');
  return HANDLERS.get(methodOf(statement))?.(statement, scope) ?? [unread(statement, scope)];
};

const isRoute = (drawn: Drawn): drawn is Route => 'verb' in drawn;

const START = { path: '', module: '', controller: '', member: '', collection: '' };

export const railsRoutesUpTo = (most: number): RouteReader => ({
  holds: path =>
    ROUTES_FILE.test(path) && !path.split('/').some(folder => NOT_SEARCHED.has(folder)),
  routes: files => {
    const budget = { left: most };
    const drawn = [...files.keys()].flatMap(file => {
      const root = ROOT_FILE.exec(file)?.[1];
      return root === undefined
        ? []
        : drawnFrom(file, { ...START, budget, files, root, loading: [], file });
    });
    return {
      routes: drawn
        .filter(isRoute)
        .map(route => ({ ...route, path: route.path === '' ? '/' : route.path })),
      unread: drawn.filter((item): item is UnreadRoute => !isRoute(item)),
    };
  },
});

export const railsRoutes = railsRoutesUpTo(MOST_STATEMENTS);
