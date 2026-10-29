import { expect, test } from 'vitest';
import { apiRoutes, callGraph, type WebCall, webCalls } from './api-paths.ts';

test.for<{
  readonly rule: string;
  readonly text: string;
  readonly paths: ReadonlyArray<string>;
}>([
  {
    rule: 'takes the path of a fetch with a quoted string',
    text: "const response = await fetch('/api/info');",
    paths: ['/api/info'],
  },
  {
    rule: 'takes the path after a ${…} origin in a template literal',
    text: 'const response = await fetch(`${import.meta.env.VITE_API_ORIGIN}/api/info`);',
    paths: ['/api/info'],
  },
  {
    rule: 'skips a path built at runtime',
    text: 'await fetch(`/api/users/${id}`);',
    paths: [],
  },
  {
    rule: 'skips a fetch of a variable',
    text: 'await fetch(url);',
    paths: [],
  },
  {
    rule: 'takes every call in a file, in order',
    text: 'await fetch("/api/users");\nawait fetch(\n  `/api/sessions`,\n  { method: "POST" },\n);',
    paths: ['/api/users', '/api/sessions'],
  },
])('$rule', ({ text, paths }) => {
  expect(webCalls([{ from: 'web/file/modules/Users/api/users.ts', text }])).toEqual(
    paths.map(path => ({ from: 'web/file/modules/Users/api/users.ts', path })),
  );
});

test('takes the routes declared across chained routers', () => {
  expect(
    apiRoutes(
      [
        'Router::new()',
        '    .route("/api/info", get(app_info))',
        '    .merge(Router::new().route("/health", get(health::<H>)))',
        '    .route( "/api/users", post(create))',
      ].join('\n'),
    ),
  ).toEqual(['/api/info', '/health', '/api/users']);
});

const call = (path: string, from = 'web/file/modules/Users/api/users.ts') => ({ from, path });

test.for<{
  readonly rule: string;
  readonly calls: ReadonlyArray<WebCall>;
  readonly graph: ReturnType<typeof callGraph>;
}>([
  {
    rule: 'joins a call to http-adapter through its route, and draws nothing for a route nobody calls',
    calls: [call('/api/users')],
    graph: {
      edges: [
        {
          from: 'web/file/modules/Users/api/users.ts',
          to: 'rust/crate/http-adapter',
          via: ['/api/users'],
        },
      ],
      dangling: [],
    },
  },
  {
    rule: "merges one file's calls into one edge through each path once",
    calls: [call('/api/users'), call('/api/sessions'), call('/api/users')],
    graph: {
      edges: [
        {
          from: 'web/file/modules/Users/api/users.ts',
          to: 'rust/crate/http-adapter',
          via: ['/api/users', '/api/sessions'],
        },
      ],
      dangling: [],
    },
  },
  {
    rule: 'keeps the calls of two files apart',
    calls: [call('/api/users'), call('/api/sessions', 'web/file/App.tsx')],
    graph: {
      edges: [
        {
          from: 'web/file/modules/Users/api/users.ts',
          to: 'rust/crate/http-adapter',
          via: ['/api/users'],
        },
        { from: 'web/file/App.tsx', to: 'rust/crate/http-adapter', via: ['/api/sessions'] },
      ],
      dangling: [],
    },
  },
  {
    rule: 'marks a call with no route as dangling',
    calls: [call('/api/users'), call('/api/app-info')],
    graph: {
      edges: [
        {
          from: 'web/file/modules/Users/api/users.ts',
          to: 'rust/crate/http-adapter',
          via: ['/api/users'],
        },
      ],
      dangling: [{ from: 'web/file/modules/Users/api/users.ts', path: '/api/app-info' }],
    },
  },
])('$rule', ({ calls, graph }) => {
  const routes = ['/api/users', '/api/sessions', '/health'].map(path => ({
    to: 'rust/crate/http-adapter',
    path,
  }));
  expect(callGraph({ calls, routes })).toEqual(graph);
});

test("a file calling the routes of two crates joins each through that crate's paths alone", () => {
  const routes = [
    { to: 'rust/crate/users', path: '/api/users' },
    { to: 'rust/crate/sessions', path: '/api/sessions' },
  ];
  expect(callGraph({ calls: [call('/api/users'), call('/api/sessions')], routes }).edges).toEqual([
    { from: 'web/file/modules/Users/api/users.ts', to: 'rust/crate/users', via: ['/api/users'] },
    {
      from: 'web/file/modules/Users/api/users.ts',
      to: 'rust/crate/sessions',
      via: ['/api/sessions'],
    },
  ]);
});
