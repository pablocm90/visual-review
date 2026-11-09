import { expect, test } from 'vitest';
import { railsAccess } from './access-reader.ts';

const PUNDIT = ['authorize', 'verify_authorized'];

const read = (files: Record<string, string>, authorize: ReadonlyArray<string> = PUNDIT) =>
  railsAccess.actions({ files: new Map(Object.entries(files)), authorize });

test("a controller's public methods are its actions, with no cover when nothing authorizes them", () => {
  expect(
    read({
      'app/controllers/users_controller.rb': `class UsersController < ApplicationController
  def index; end

  private

  def helper; end
end
`,
    }),
  ).toStrictEqual({
    actions: [
      {
        controller: 'UsersController',
        action: 'index',
        root: '',
        file: 'app/controllers/users_controller.rb',
        line: 2,
      },
    ],
    unread: [],
  });
});

test.for([
  { path: 'app/controllers/users_controller.rb', held: true },
  { path: 'apps/shop/app/controllers/admin/users_controller.rb', held: true },
  { path: 'app/controllers/concerns/authorized.rb', held: true },
  { path: 'app/models/user.rb', held: false },
  { path: 'app/controllers/users_controller.js', held: false },
  { path: 'vendor/gems/x/app/controllers/users_controller.rb', held: false },
])('$path is held: $held', ({ path, held }) => {
  expect(railsAccess.holds(path)).toBe(held);
});

const coverOf = (body: string, authorize: ReadonlyArray<string> = ['require_admin']) =>
  read(
    {
      'app/controllers/admin/users_controller.rb': `module Admin
  class UsersController < ApplicationController
${body}
    def index; end
  end
end
`,
    },
    authorize,
  ).actions.map(({ cover }) => cover);

test.for([
  {
    callback: 'an authorizing before_action',
    body: '    before_action :set_user, :require_admin',
    cover: { by: 'require_admin', conditional: false },
  },
  { callback: 'a before_action that authorizes nothing', body: '    before_action :set_user' },
  {
    callback: 'a before_action only for the action',
    body: '    before_action :require_admin, only: %i[index show]',
    cover: { by: 'require_admin', conditional: false },
  },
  {
    callback: 'a before_action only for another action',
    body: '    before_action :require_admin, only: :show',
  },
  {
    callback: 'a before_action except for another action',
    body: '    before_action :require_admin, except: [:show]',
    cover: { by: 'require_admin', conditional: false },
  },
  {
    callback: 'a before_action except for the action',
    body: '    before_action :require_admin, except: :index',
  },
])('the cover $callback gives the actions under it', ({ body, cover }) => {
  expect(coverOf(body)).toStrictEqual([cover]);
});
