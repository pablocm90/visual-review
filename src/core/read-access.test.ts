import { expect, test } from 'vitest';
import { railsAccess } from '../readers/rails/access-reader.ts';
import { commit, git, gitRepo } from '../test-support/repos.ts';
import { readAccess } from './read-access.ts';

const APPLICATION = 'app/controllers/application_controller.rb';

const USERS = 'app/controllers/users_controller.rb';

const changesOf = (repo: string, from: string, to: string): ReadonlyArray<ReadonlyArray<string>> =>
  git(repo, 'diff', '--name-status', '--find-renames', from, to)
    .split('\n')
    .filter(line => line !== '')
    .map(line => line.split('\t').slice(1));

const read = (repo: string, base: string, head: string, routed = false) =>
  readAccess({
    repo,
    base,
    head,
    changes: changesOf(repo, base, head),
    routed,
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

test('no controller changed: no reading', async () => {
  using workspace = gitRepo({ [USERS]: users('  def index; end'), 'app/a.rb': '' });
  const { repo, root } = workspace;
  const to = commit(repo, { 'app/a.rb': 'class A; end\n' });

  expect(await read(repo, root, to)).toStrictEqual([]);
});

test('no controller changed but a route added or repointed: every controller reads', async () => {
  using workspace = gitRepo({ [USERS]: users('  def index; end'), 'config/routes.rb': '' });
  const { repo, root } = workspace;
  const to = commit(repo, { 'config/routes.rb': 'Rails.application.routes.draw do\nend\n' });

  expect(await read(repo, root, to, true)).toMatchObject([
    { base: { actions: [{ action: 'index' }] }, head: { actions: [{ action: 'index' }] } },
  ]);
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
