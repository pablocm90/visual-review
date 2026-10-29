import type { GraphEdge } from '../../graph.ts';
import type { DanglingCall, Links } from '../../linker.ts';

export type WebCall = DanglingCall;

const FETCH_LITERAL = /fetch\(\s*(['"`])(.*?)\1/g;

const LEADING_ORIGIN = /^\$\{[^}]*\}/;

const ROUTE_LITERAL = /\.route\(\s*"([^"]*)"/g;

type CallingFile = {
  readonly from: string;
  readonly text: string;
};

export const webCalls = (files: ReadonlyArray<CallingFile>): ReadonlyArray<WebCall> =>
  files.flatMap(({ from, text }) =>
    [...text.matchAll(FETCH_LITERAL)]
      .map(([, , literal = '']) => literal.replace(LEADING_ORIGIN, ''))
      .filter(path => !path.includes('${'))
      .map(path => ({ from, path })),
  );

type Route = {
  readonly to: string;
  readonly path: string;
};

type CallGraphOptions = {
  readonly calls: ReadonlyArray<WebCall>;
  readonly routes: ReadonlyArray<Route>;
};

export const callGraph = ({ calls, routes }: CallGraphOptions): Links => {
  const routed = calls.flatMap(({ from, path }) =>
    routes.filter(route => route.path === path).map(({ to }) => ({ from, to, path })),
  );
  const pairs = new Map(routed.map(({ from, to }) => [JSON.stringify([from, to]), { from, to }]));
  return {
    edges: [...pairs.values()].map(
      ({ from, to }): GraphEdge => ({
        from,
        to,
        via: [
          ...new Set(
            routed.filter(other => other.from === from && other.to === to).map(({ path }) => path),
          ),
        ],
      }),
    ),
    dangling: calls.filter(({ path }) => !routes.some(route => route.path === path)),
  };
};

export const apiRoutes = (text: string): ReadonlyArray<string> =>
  [...text.matchAll(ROUTE_LITERAL)].map(([, path = '']) => path);
