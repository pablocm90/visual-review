import { expect, test } from 'vitest';
import { railsAccess } from '../readers/rails/access-reader.ts';
import { readRange } from '../test-support/read-range.ts';
import { commit, git, gitRepo } from '../test-support/repos.ts';
import { pageData } from './page.ts';
import { readAccess } from './read-access.ts';

const APPLICATION = 'app/controllers/application_controller.rb';

const USERS = 'app/controllers/users_controller.rb';

const changesOf = (repo: string, from: string, to: string): ReadonlyArray<ReadonlyArray<string>> =>
  git(repo, 'diff', '--name-status', '--find-renames', from, to)
    .split('\n')
    .filter(line => line !== '')
    .map(line => line.split('\t').slice(1));

const read = (repo: string, base: string, head: string) =>
  readAccess({
    repo,
    base,
    head,
    changes: changesOf(repo, base, head),
    routed: false,
    access: [railsAccess],
    authorize: ['authorize'],
  });

const users = (actions: string) =>
  `class UsersController < ApplicationController\n${actions}\nend\n`;

test("a changed controller reads every controller at both sides, its parent's cover included", async () => {
  using workspace = gitRepo({
    [APPLICATION]:
      'class ApplicationController < ActionController::Base\n  before_action :authorize\nend\n',
    [USERS]: users('  def index; end'),
    'app/models/user.rb': 'class User\n  def name; end\nend\n',
  });
  const { repo, root } = workspace;
  const to = commit(repo, { [USERS]: users('  def index; end\n  def show; end') });

  const [reading] = await read(repo, root, to);

  expect(reading).toMatchObject({
    base: { actions: [{ action: 'index', cover: { by: 'authorize' } }] },
    head: {
      actions: [
        { action: 'index', cover: { by: 'authorize' } },
        { action: 'show', cover: { by: 'authorize' } },
      ],
    },
  });
});

test('a controller moved out of the controllers still reads, at the side that held it', async () => {
  using workspace = gitRepo({ [USERS]: users('  def index; end') });
  const { repo, root } = workspace;
  git(repo, 'mv', USERS, 'app/users_controller.rb');
  const to = commit(repo, { 'app/users_controller.rb': users('  def index; end') });

  expect(await read(repo, root, to)).toMatchObject([
    { base: { actions: [{ action: 'index' }] }, head: { actions: [] } },
  ]);
});

test("a range reading reads access at the defaults' authorize names, Pundit's among them", async () => {
  using workspace = gitRepo({ [USERS]: users('  def index; end') });
  const { repo, root } = workspace;
  const to = commit(repo, { [USERS]: users('  def index; authorize User; end') });

  const { access } = await readRange({ repo, from: root, to });

  expect(access).toMatchObject([
    {
      base: { actions: [{ action: 'index' }] },
      head: { actions: [{ action: 'index', cover: { by: 'authorize' } }] },
    },
  ]);
});

test('a range adding a route and no controller reads access too', async () => {
  using workspace = gitRepo({ [USERS]: users('  def show; end'), 'config/routes.rb': '' });
  const { repo, root } = workspace;
  const to = commit(repo, {
    'config/routes.rb': 'Rails.application.routes.draw do\n  get "u", to: "users#show"\nend\n',
  });

  const { access } = await readRange({ repo, from: root, to });

  expect(access).toHaveLength(1);
});

test('a range changing no controller and no route reads no access', async () => {
  using workspace = gitRepo({ [USERS]: users('  def show; end'), 'app/a.rb': '' });
  const { repo, root } = workspace;
  const to = commit(repo, { 'app/a.rb': 'class A; end\n' });

  const { access } = await readRange({ repo, from: root, to });

  expect(access).toStrictEqual([]);
});

test("the config's security.authorize replaces the default names", async () => {
  using workspace = gitRepo({
    'visual-review.config.json': '{"security": {"authorize": ["require_*!"]}}',
    [USERS]: users('  def index; end'),
  });
  const { repo, root } = workspace;
  const to = commit(repo, {
    [USERS]: users(
      '  before_action :require_admin!, only: :index\n  def index; end\n  def show; authorize User; end',
    ),
  });

  const { access } = await readRange({ repo, from: root, to });

  expect(
    access.flatMap(({ head }) => head.actions.map(({ action, cover }) => [action, cover?.by])),
  ).toStrictEqual([
    ['index', 'require_admin!'],
    ['show', undefined],
  ]);
});

test("an action the config's security.open lists raises no finding on the page", async () => {
  using workspace = gitRepo({
    'visual-review.config.json': '{"security": {"open": ["UsersController#show"]}}',
    [USERS]: users(''),
  });
  const { repo, root } = workspace;
  const to = commit(repo, { [USERS]: users('  def index; end\n  def show; end') });

  const reading = await readRange({ repo, from: root, to });

  expect(
    pageData({ reading, repo: 'shop', range: 'a..b', version: '0', parsers: {} })
      .findings.filter(({ check }) => check === 'security:unauthorized')
      .map(({ id }) => id),
  ).toStrictEqual(['security:unauthorized::UsersController#index']);
});

const unauthorizedOn = async (repo: string, from: string, to: string) =>
  pageData({
    reading: await readRange({ repo, from, to }),
    repo: 'shop',
    range: 'a..b',
    version: '0',
    parsers: {},
  })
    .findings.filter(({ check }) => check === 'security:unauthorized')
    .map(({ id }) => id);

test.for([
  {
    reason: 'opens the action it adds',
    config: '{"security": {"open": ["UsersController#index"]}}',
    actions: '  def index; end',
  },
  {
    reason: 'names the callback it adds as authorizing',
    config: '{"security": {"authorize": ["anything"]}}',
    actions: '  before_action :anything\n  def index; end',
  },
])(
  "security is read from the base, so a head config that $reason still raises the action's finding",
  async ({ config, actions }) => {
    using workspace = gitRepo({ [USERS]: users('') });
    const { repo, root } = workspace;
    const to = commit(repo, { 'visual-review.config.json': config, [USERS]: users(actions) });

    expect(await unauthorizedOn(repo, root, to)).toStrictEqual([
      'security:unauthorized::UsersController#index',
    ]);
  },
);
