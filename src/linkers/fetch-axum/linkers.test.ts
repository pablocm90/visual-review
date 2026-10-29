import { expect, test } from 'vitest';
import { readRange } from '../../test-support/read-range.ts';
import {
  axumCrate,
  cargoWorkspace,
  commit,
  crateFiles,
  gitRepo,
} from '../../test-support/repos.ts';

test("a TS stack's fetch joins the axum crate that declares its route, under the ids the stacks are drawn with", async () => {
  using workspace = cargoWorkspace();
  const { repo, root } = workspace;
  const to = commit(repo, {
    ...axumCrate('app'),
    ...axumCrate('routes', 'Router::new().route("/api/info", get(info))\n'),
    ...crateFiles('legacy'),
    'crates/legacy/src/lib.rs': 'Router::new().route("/api/info", get(info))\n',
    'front/package.json': '{}\n',
    'front/src/a.ts': "export const a = () => fetch('/api/info');\n",
  });

  const range = await readRange({ repo, from: root, to });

  expect(range.after.edges.filter(({ via }) => via !== undefined)).toEqual([
    { from: 'front/file/a.ts', to: 'rust/crate/routes', via: ['/api/info'] },
  ]);
});

test.for([
  { reason: 'a TS-only repo', files: {} },
  {
    reason: 'a repo whose crates declare routes without depending on axum',
    files: {
      'Cargo.toml': '[workspace]\nmembers = ["crates/*"]\nresolver = "2"\n',
      ...crateFiles('routes'),
      'crates/routes/src/lib.rs': 'Router::new().route("/api/info", get(info))\n',
    },
  },
])('$reason draws no call, routed or dangling', async ({ files }) => {
  using workspace = gitRepo({ 'package.json': '{"name": "app"}\n', 'src/a.ts': '' });
  const { repo, root } = workspace;
  const to = commit(repo, {
    ...files,
    'src/a.ts': "export const a = () => [fetch('/api/info'), fetch('/api/gone')];\n",
  });

  const range = await readRange({ repo, from: root, to });

  expect(range.after.edges).toEqual([]);
  expect(range.danglingCalls).toEqual([]);
});

test("each side joins a web file's fetch to http-adapter through a matching route, and the after side lists calls that lost their route", async () => {
  using workspace = cargoWorkspace();
  const { repo } = workspace;
  const routes = (path: string) =>
    axumCrate('http-adapter', `Router::new().route("${path}", get(info))\n`);
  const from = commit(repo, {
    ...routes('/api/info'),
    'web/package.json': '{}\n',
    'web/src/modules/A/api/a.ts': "export const a = () => fetch('/api/info');\n",
  });
  const to = commit(repo, routes('/api/app-info'));

  const range = await readRange({ repo, from, to });

  const call = { from: 'web/file/modules/A/api/a.ts', to: 'rust/crate/http-adapter' };
  expect(range.before.edges).toContainEqual({ ...call, via: ['/api/info'] });
  expect(range.after.edges).not.toContainEqual(expect.objectContaining(call));
  expect(range.danglingCalls).toEqual([{ from: call.from, path: '/api/info' }]);
});

test('a fetch from a file that is no node of the page draws no call, routed or dangling', async () => {
  using workspace = cargoWorkspace();
  const { repo } = workspace;
  const from = commit(repo, {
    ...axumCrate('http-adapter', 'Router::new().route("/api/info", get(info))\n'),
    'web/src/a.ts': "export const a = () => fetch('/api/info');\n",
  });
  const to = commit(repo, { 'web/src/a.ts': "export const a = () => fetch('/api/gone');\n" });

  const range = await readRange({ repo, from, to });

  expect(range.before.edges).toEqual([]);
  expect(range.danglingCalls).toEqual([]);
});

test.for([
  '[dependencies]\naxum.workspace = true\n',
  '[dependencies]\n  axum = "0.8"\n',
  '[dependencies.axum]\nversion = "0.8"\n\n[features]\ndefault = []\n',
  '[target.\'cfg(unix)\'.dependencies]\naxum = "0.8"\n',
  '[target.\'cfg(unix)\'.dependencies.axum]\nversion = "0.8"\n',
])('a crate whose manifest declares axum as %j serves routes', async dependency => {
  using workspace = cargoWorkspace();
  const { repo, root } = workspace;
  const to = commit(repo, {
    ...crateFiles('routes'),
    'crates/routes/Cargo.toml': `${crateFiles('routes')['crates/routes/Cargo.toml']}\n${dependency}`,
    'Cargo.toml':
      '[workspace]\nmembers = ["crates/*"]\nresolver = "2"\n\n[workspace.dependencies]\naxum = "0.8"\n',
    'crates/routes/src/lib.rs': 'Router::new().route("/api/info", get(info))\n',
    'web/package.json': '{}\n',
    'web/src/a.ts': "export const a = () => fetch('/api/info');\n",
  });

  const range = await readRange({ repo, from: root, to });

  expect(range.after.edges).toContainEqual(
    expect.objectContaining({ from: 'web/file/a.ts', to: 'rust/crate/routes' }),
  );
});

test.for([
  '[workspace.dependencies]\naxum = "0.8"\n',
  '[workspace.dependencies.axum]\nversion = "0.8"\n',
  '[dev-dependencies]\naxum = "0.8"\n',
  '[build-dependencies]\naxum = "0.8"\n',
  '[target.\'cfg(unix)\'.dev-dependencies]\naxum = "0.8"\n',
  '[features]\naxum = []\n',
])('a crate whose manifest names axum only as %j serves no routes', async section => {
  using workspace = gitRepo({ 'README.md': '' });
  const { repo, root } = workspace;
  const to = commit(repo, {
    'Cargo.toml': `${crateFiles('app')['crates/app/Cargo.toml']}\n[dependencies]\nserde = "1"\n\n[workspace]\n\n${section}`,
    'src/lib.rs': 'Router::new().route("/api/info", get(info))\n',
    'web/package.json': '{}\n',
    'web/src/a.ts': "export const a = () => fetch('/api/info');\n",
  });

  const range = await readRange({ repo, from: root, to });

  expect(range.after.edges.filter(({ via }) => via !== undefined)).toEqual([]);
});

test.for([
  {
    reason: 'no entry links every TS stack to every Rust stack',
    linkers: {},
    edges: [
      ['admin/file/a.ts', 'other/crate/more'],
      ['admin/file/a.ts', 'rust/crate/routes'],
      ['web/file/a.ts', 'other/crate/more'],
      ['web/file/a.ts', 'rust/crate/routes'],
    ],
  },
  {
    reason: 'from limits the calls to those stacks',
    linkers: { 'fetch-axum': { from: ['web'] } },
    edges: [
      ['web/file/a.ts', 'other/crate/more'],
      ['web/file/a.ts', 'rust/crate/routes'],
    ],
  },
  {
    reason: 'to limits the routes to those stacks',
    linkers: { 'fetch-axum': { to: ['other'] } },
    edges: [
      ['admin/file/a.ts', 'other/crate/more'],
      ['web/file/a.ts', 'other/crate/more'],
    ],
  },
  { reason: 'false turns the linker off', linkers: { 'fetch-axum': false }, edges: [] },
])("the config's linkers entry: $reason", async ({ linkers, edges }) => {
  const fetches = "export const a = () => [fetch('/api/info'), fetch('/api/gone')];\n";
  const route = 'Router::new().route("/api/info", get(info))\n';
  using workspace = cargoWorkspace();
  const { repo, root } = workspace;
  const to = commit(repo, {
    ...axumCrate('routes', route),
    'other/Cargo.toml': '[workspace]\nmembers = ["crates/*"]\nresolver = "2"\n',
    ...Object.fromEntries(
      Object.entries(axumCrate('more', route)).map(([path, text]) => [`other/${path}`, text]),
    ),
    'web/package.json': '{}\n',
    'web/src/a.ts': fetches,
    'admin/package.json': '{}\n',
    'admin/src/a.ts': fetches,
    'visual-review.config.json': JSON.stringify({
      stacks: { other: { reader: 'rust', root: 'other' } },
      linkers,
    }),
  });

  const range = await readRange({ repo, from: root, to });

  const linked = range.after.edges
    .filter(({ via }) => via !== undefined)
    .map(({ from, to }) => [from, to])
    .toSorted();
  expect(linked).toEqual(edges);
  expect(range.danglingCalls.length > 0).toBe(edges.length > 0);
});

test("a crate's routes come from its own compiled files, not from crates, tests or examples inside its folder", async () => {
  const route = (path: string) => `Router::new().route("${path}", get(info))\n`;
  using workspace = gitRepo({ 'README.md': '' });
  const { repo, root } = workspace;
  const to = commit(repo, {
    'Cargo.toml': `${axumCrate('app')['crates/app/Cargo.toml']}\n[workspace]\nmembers = ["crates/*", "crates/api/plugin"]\nresolver = "2"\n`,
    'src/lib.rs': '',
    'tests/mock.rs': route('/api/mock'),
    'examples/demo.rs': route('/api/demo'),
    ...axumCrate('api', route('/api/info')),
    'crates/api/plugin/Cargo.toml': `${axumCrate('plugin')['crates/plugin/Cargo.toml']}`,
    'crates/api/plugin/src/lib.rs': route('/api/plugin'),
    'web/package.json': '{}\n',
    'web/src/a.ts': ['/api/info', '/api/plugin', '/api/mock', '/api/demo']
      .map(path => `fetch('${path}');\n`)
      .join(''),
  });

  const range = await readRange({ repo, from: root, to });

  expect(range.after.edges.filter(({ via }) => via !== undefined)).toEqual([
    { from: 'web/file/a.ts', to: 'rust/crate/api', via: ['/api/info'] },
    { from: 'web/file/a.ts', to: 'rust/crate/plugin', via: ['/api/plugin'] },
  ]);
  expect(range.danglingCalls).toEqual([
    { from: 'web/file/a.ts', path: '/api/mock' },
    { from: 'web/file/a.ts', path: '/api/demo' },
  ]);
});

test('a fetch named in a Rust file is no call, though Rust files are file nodes too', async () => {
  using workspace = cargoWorkspace();
  const { repo, root } = workspace;
  const to = commit(
    repo,
    axumCrate(
      'routes',
      '/// Call it with fetch(\'/api/gone\').\npub fn routes() { Router::new().route("/api/info", get(info)); }\n',
    ),
  );

  const range = await readRange({ repo, from: root, to });

  expect(range.danglingCalls).toEqual([]);
});
