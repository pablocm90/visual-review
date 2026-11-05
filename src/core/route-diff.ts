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

const countsOf = (items: ReadonlyArray<UnreadRoute>): ReadonlyMap<string, number> => {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = unreadKey(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
};

const beyond = (
  items: ReadonlyArray<UnreadRoute>,
  others: ReadonlyArray<UnreadRoute>,
): ReadonlyArray<UnreadRoute> => {
  const inOthers = countsOf(others);
  const seen = new Map<string, number>();
  return items.filter(item => {
    const key = unreadKey(item);
    const before = seen.get(key) ?? 0;
    seen.set(key, before + 1);
    return before >= (inOthers.get(key) ?? 0);
  });
};

export const diffRoutes = ({ base, head }: Sides): RoutesDiff => ({
  routes: routeChanges({ base, head }),
  unread: [
    ...beyond(head.unread, base.unread).map(item => ({ state: 'added' as const, item })),
    ...beyond(base.unread, head.unread).map(item => ({ state: 'removed' as const, item })),
  ],
});
