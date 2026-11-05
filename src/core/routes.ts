export type Route = {
  readonly verb: string;
  readonly path: string;
  readonly target: string;
  readonly root: string;
  readonly file: string;
  readonly line: number;
};

export type UnreadRoute = {
  readonly text: string;
  readonly path: string;
  readonly module: string;
  readonly root: string;
  readonly file: string;
  readonly line: number;
};

export type RouteTable = {
  readonly routes: ReadonlyArray<Route>;
  readonly unread: ReadonlyArray<UnreadRoute>;
};

export type RouteReader = {
  readonly holds: (path: string) => boolean;
  readonly routes: (files: ReadonlyMap<string, string>) => RouteTable;
};
