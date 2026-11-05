import type { Route, RouteTable, UnreadRoute } from './routes.ts';

export type RouteChange =
  | { readonly state: 'added'; readonly head: Route }
  | { readonly state: 'removed'; readonly base: Route }
  | { readonly state: 'changed'; readonly base: Route; readonly head: Route };

export type UnreadChange = {
  readonly state: 'added' | 'removed';
  readonly item: UnreadRoute;
};

export type RoutesDiff = {
  readonly routes: ReadonlyArray<RouteChange>;
  readonly unread: ReadonlyArray<UnreadChange>;
};

type Sides = { readonly base: RouteTable; readonly head: RouteTable };

const answeringRoutes = (routes: ReadonlyArray<Route>): ReadonlyMap<string, Route> => {
  const keyed = routes.map((route): readonly [string, Route] => [
    JSON.stringify([route.root, route.verb, route.path]),
    route,
  ]);
  return new Map([...keyed, ...keyed.toReversed()]);
};

const routeChanges = ({ base, head }: Sides): ReadonlyArray<RouteChange> => {
  const baseRoutes = answeringRoutes(base.routes);
  const headRoutes = answeringRoutes(head.routes);
  return [
    ...[...headRoutes].flatMap(([key, route]): ReadonlyArray<RouteChange> => {
      const other = baseRoutes.get(key);
      if (other === undefined) return [{ state: 'added', head: route }];
      return other.target === route.target ? [] : [{ state: 'changed', base: other, head: route }];
    }),
    ...[...baseRoutes]
      .filter(([key]) => !headRoutes.has(key))
      .map(([, route]): RouteChange => ({ state: 'removed', base: route })),
  ];
};

const unreadKey = ({ root, path, module, text }: UnreadRoute) =>
  JSON.stringify([root, path, module, text]);

const beyond = (
  items: ReadonlyArray<UnreadRoute>,
  others: ReadonlyArray<UnreadRoute>,
): ReadonlyArray<UnreadRoute> => {
  const matching = (list: ReadonlyArray<UnreadRoute>, key: string) =>
    list.filter(item => unreadKey(item) === key).length;
  return items.filter(
    (item, at) =>
      matching(items.slice(0, at), unreadKey(item)) >= matching(others, unreadKey(item)),
  );
};

export const diffRoutes = ({ base, head }: Sides): RoutesDiff => ({
  routes: routeChanges({ base, head }),
  unread: [
    ...beyond(head.unread, base.unread).map(item => ({ state: 'added' as const, item })),
    ...beyond(base.unread, head.unread).map(item => ({ state: 'removed' as const, item })),
  ],
});
