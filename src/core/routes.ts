export type Route = {
  readonly verb: string;
  readonly path: string;
  readonly target: string;
  readonly file: string;
  readonly line: number;
};

export type RouteTable = {
  readonly routes: ReadonlyArray<Route>;
};

export type RouteReader = {
  readonly holds: (path: string) => boolean;
  readonly routes: (files: ReadonlyMap<string, string>) => RouteTable;
};
