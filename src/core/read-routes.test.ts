import { expect, test } from 'vitest';
import { railsRoutes } from '../readers/rails/route-reader.ts';
import { readRange } from '../test-support/read-range.ts';
import { commit, git, gitRepo } from '../test-support/repos.ts';
import { readRoutes } from './read-routes.ts';

const ROUTES = 'config/routes.rb';

const drawing = (body: string) => `Rails.application.routes.draw do\n${body}\nend\n`;

const USERS = 'resources :users, only: [:index]';

const changesOf = (repo: string, from: string, to: string): ReadonlyArray<ReadonlyArray<string>> =>
  git(repo, 'diff', '--name-status', '--find-renames', from, to)
    .split('\n')
    .filter(line => line !== '')
    .map(line => line.split('\t').slice(1));

const read = (repo: string, base: string, head: string) =>
  readRoutes({
    repo,
    base,
    head,
    changes: changesOf(repo, base, head),
    routes: [railsRoutes],
  });

test('a changed route file reads as what changed between its sides, each row with its patch', async () => {
  using workspace = gitRepo({ [ROUTES]: drawing(USERS) });
  const { repo, root } = workspace;
  const to = commit(repo, { [ROUTES]: drawing(`${USERS}\nget "ping", to: "a#b"`) });

  expect(await read(repo, root, to)).toStrictEqual([
    {
      routes: [
        {
          state: 'added',
          head: { verb: 'GET', path: '/ping', target: 'a#b', root: '', file: ROUTES, line: 3 },
          patch: ROUTES,
        },
      ],
      unread: [],
    },
  ]);
});

test("a range's reading holds its route changes", async () => {
  using workspace = gitRepo({ [ROUTES]: drawing(USERS) });
  const { repo, root } = workspace;
  const to = commit(repo, { [ROUTES]: drawing(`${USERS}\nget "ping", to: "a#b"`) });

  const { routes } = await readRange({ repo, from: root, to });

  expect(routes).toHaveLength(1);
});

test('what cannot be read carries its patch too, and a removed route its own', async () => {
  using workspace = gitRepo({ [ROUTES]: drawing(USERS) });
  const { repo, root } = workspace;
  const to = commit(repo, { [ROUTES]: drawing('devise_for :users') });

  const [reading] = await read(repo, root, to);

  expect(reading).toMatchObject({
    routes: [{ state: 'removed', patch: ROUTES }],
    unread: [{ state: 'added', item: { text: 'devise_for :users' }, patch: ROUTES }],
  });
});

test('no route file changed: no reading', async () => {
  using workspace = gitRepo({ [ROUTES]: drawing(USERS), 'app/a.rb': '' });
  const { repo, root } = workspace;
  const to = commit(repo, { 'app/a.rb': 'class A; end\n' });

  expect(await read(repo, root, to)).toStrictEqual([]);
});

test('a route file changed without changing a route: no reading', async () => {
  using workspace = gitRepo({ [ROUTES]: drawing(USERS) });
  const { repo, root } = workspace;
  const to = commit(repo, { [ROUTES]: drawing(`# a comment\n${USERS}`) });

  expect(await read(repo, root, to)).toStrictEqual([]);
});

const ADMIN_FILE = 'config/routes/admin.rb';

test('a removed route in a renamed file opens at its new path', async () => {
  using workspace = gitRepo({
    [ROUTES]: drawing('draw :admin'),
    [ADMIN_FILE]: `${USERS}\nget "ping", to: "a#b"\nget "pong", to: "a#c"\n`,
  });
  const { repo, root } = workspace;
  git(repo, 'mv', ADMIN_FILE, 'config/routes/staff.rb');
  const to = commit(repo, {
    [ROUTES]: drawing('draw :staff'),
    'config/routes/staff.rb': `${USERS}\nget "ping", to: "a#b"\n`,
  });

  const [reading] = await read(repo, root, to);

  expect(reading).toMatchObject({
    routes: [
      {
        state: 'removed',
        base: { path: '/pong', file: ADMIN_FILE },
        patch: 'config/routes/staff.rb',
      },
    ],
  });
});

test('a route moved by a change to another file opens at the file that changed', async () => {
  using workspace = gitRepo({
    [ROUTES]: drawing('namespace :admin do\n  draw :staff\nend'),
    'config/routes/staff.rb': 'get "ping", to: "a#b"\n',
  });
  const { repo, root } = workspace;
  const to = commit(repo, { [ROUTES]: drawing('namespace :team do\n  draw :staff\nend') });

  const [reading] = await read(repo, root, to);

  expect(reading).toMatchObject({
    routes: [
      { state: 'added', head: { file: 'config/routes/staff.rb' }, patch: ROUTES },
      { state: 'removed', base: { file: 'config/routes/staff.rb' }, patch: ROUTES },
    ],
  });
});

test('what cannot be read in an unchanged file opens at the file that changed', async () => {
  using workspace = gitRepo({
    [ROUTES]: drawing('namespace :admin do\n  draw :staff\nend'),
    'config/routes/staff.rb': 'devise_for :users\n',
  });
  const { repo, root } = workspace;
  const to = commit(repo, { [ROUTES]: drawing('namespace :team do\n  draw :staff\nend') });

  const [reading] = await read(repo, root, to);

  expect(reading).toMatchObject({
    unread: [
      { state: 'added', item: { file: 'config/routes/staff.rb' }, patch: ROUTES },
      { state: 'removed', item: { file: 'config/routes/staff.rb' }, patch: ROUTES },
    ],
  });
});

test('a changed route that also moved file opens at the file it is in now', async () => {
  using workspace = gitRepo({
    [ROUTES]: drawing('get "ping", to: "a#b"\ndraw :staff'),
    'config/routes/staff.rb': 'get "pong", to: "a#c"\n',
  });
  const { repo, root } = workspace;
  const to = commit(repo, {
    [ROUTES]: drawing('draw :staff'),
    'config/routes/staff.rb': 'get "pong", to: "a#c"\nget "ping", to: "a#d"\n',
  });

  const [reading] = await read(repo, root, to);

  expect(reading).toMatchObject({
    routes: [{ state: 'changed', patch: 'config/routes/staff.rb' }],
  });
});

test('a side the reader cannot read gives the changed file and why, on either side', async () => {
  using workspace = gitRepo({ [ROUTES]: drawing(USERS) });
  const { repo, root } = workspace;
  const broken = commit(repo, { [ROUTES]: 'Rails.application.routes.draw do\n' });
  const fixed = commit(repo, { [ROUTES]: drawing(USERS) });

  const notRead = { file: ROUTES, notRead: `Ruby syntax error in ${ROUTES}` };
  expect(await read(repo, root, broken)).toStrictEqual([notRead]);
  expect(await read(repo, broken, fixed)).toStrictEqual([notRead]);
});

test('a route file broken on both sides and not changed raises nothing', async () => {
  using workspace = gitRepo({ [ROUTES]: 'Rails.application.routes.draw do\n', 'app/a.rb': '' });
  const { repo, root } = workspace;
  const to = commit(repo, { 'app/a.rb': 'class A; end\n' });

  expect(await read(repo, root, to)).toStrictEqual([]);
});

test('a file moved into the route files counts as changing them', async () => {
  const body = 'get "ping", to: "a#b"\n';
  using workspace = gitRepo({ [ROUTES]: drawing('draw :staff'), 'lib/staff.rb': body });
  const { repo, root } = workspace;
  git(repo, 'rm', '--quiet', 'lib/staff.rb');
  const to = commit(repo, { 'config/routes/staff.rb': body });

  const [reading] = await read(repo, root, to);

  expect(reading).toMatchObject({
    routes: [{ state: 'added', head: { path: '/ping' }, patch: 'config/routes/staff.rb' }],
  });
});

test('a file outside the route files is not read as routes, even loaded', async () => {
  const load = 'load Rails.root.join("lib/staff.rb")';
  using workspace = gitRepo({
    [ROUTES]: drawing(USERS),
    'lib/staff.rb': 'get "ping", to: "a#b"\n',
  });
  const { repo, root } = workspace;
  const to = commit(repo, { [ROUTES]: drawing(`${USERS}\n${load}`) });

  const [reading] = await read(repo, root, to);

  expect(reading).toMatchObject({ routes: [], unread: [{ item: { text: load } }] });
});
