import { expect, test } from 'vitest';
import { railsAccess } from './access-reader.ts';

const PUNDIT = ['authorize', 'verify_authorized'];

const read = (files: Record<string, string>, authorize: ReadonlyArray<string> = PUNDIT) =>
  railsAccess.actions({ files: new Map(Object.entries(files)), authorize });

test("a controller's public methods are its actions, with no cover when nothing authorizes them", () => {
  expect(
    read({
      'app/controllers/users_controller.rb': `class UsersController < ActionController::Base
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

const coverOf = (body: string) =>
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
    ['require_admin', 'verify_authorized'],
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
  {
    callback: 'a prepend_before_action',
    body: '    prepend_before_action :require_admin',
    cover: { by: 'require_admin', conditional: false },
  },
  {
    callback: 'an after_action',
    body: '    after_action :require_admin',
    cover: { by: 'require_admin', conditional: false },
  },
  {
    callback: 'an around_action',
    body: '    around_action :require_admin',
    cover: { by: 'require_admin', conditional: false },
  },
  {
    callback: 'an after_action skipped later',
    body: '    append_after_action :require_admin\n    skip_after_action :require_admin',
  },
  {
    callback: 'a before_action skipped later',
    body: '    before_action :require_admin\n    skip_before_action :require_admin',
  },
  {
    callback: 'a before_action skipped for another action',
    body: '    before_action :require_admin\n    skip_before_action :require_admin, only: :show',
    cover: { by: 'require_admin', conditional: false },
  },
  {
    callback: 'a before_action beside a skip of another callback',
    body: '    before_action :require_admin\n    skip_before_action :set_user',
    cover: { by: 'require_admin', conditional: false },
  },
  {
    callback: 'a before_action set again after its skip',
    body: '    skip_before_action :require_admin\n    before_action :require_admin',
    cover: { by: 'require_admin', conditional: false },
  },
  {
    callback: 'a before_action under an if',
    body: '    before_action :require_admin, if: :admin_area?',
    cover: { by: 'require_admin', conditional: true },
  },
  {
    callback: 'a before_action under an unless',
    body: '    before_action :require_admin, unless: -> { request.format.json? }',
    cover: { by: 'require_admin', conditional: true },
  },
  {
    callback: 'a before_action under an if beside one under none',
    body: '    before_action :require_admin, if: :admin_area?\n    after_action :verify_authorized',
    cover: { by: 'verify_authorized', conditional: false },
  },
  {
    callback: 'a before_action skipped under an if',
    body: '    before_action :require_admin\n    skip_before_action :require_admin, if: :public?',
    cover: { by: 'require_admin', conditional: true },
  },
  {
    callback: 'a block calling an authorizing method',
    body: '    before_action { require_admin }',
    cover: { by: 'require_admin', conditional: false },
  },
])('the cover $callback gives the actions under it', ({ body, cover }) => {
  expect(coverOf(body)).toStrictEqual([cover]);
});

const coversIn = (files: Record<string, string>) =>
  Object.fromEntries(
    read(files, ['require_admin']).actions.map(({ controller, action, cover }) => [
      `${controller}#${action}`,
      cover?.by,
    ]),
  );

const USERS = `class UsersController < ApplicationController
  def index; end
end
`;

test.for([
  {
    reason: "its parent's callback",
    files: {
      'app/controllers/application_controller.rb': `class ApplicationController < ActionController::Base
  before_action :require_admin
end
`,
      'app/controllers/users_controller.rb': USERS,
    },
    covers: { 'UsersController#index': 'require_admin' },
  },
  {
    reason: "nothing, when it skips its parent's callback",
    files: {
      'app/controllers/application_controller.rb': `class ApplicationController < ActionController::Base
  before_action :require_admin
end
`,
      'app/controllers/users_controller.rb': `class UsersController < ApplicationController
  skip_before_action :require_admin
  def index; end
end
`,
    },
    covers: { 'UsersController#index': undefined },
  },
  {
    reason: 'the parent its lexical scope names first',
    files: {
      'app/controllers/base_controller.rb': `class BaseController < ActionController::Base
end
`,
      'app/controllers/admin/base_controller.rb': `module Admin
  class BaseController < ActionController::Base
    before_action :require_admin
  end
end
`,
      'app/controllers/admin/users_controller.rb': `module Admin
  class UsersController < BaseController
    def index; end
  end
end
`,
    },
    covers: { 'Admin::UsersController#index': 'require_admin' },
  },
  {
    reason: 'the top-level parent a leading :: names',
    files: {
      'app/controllers/base_controller.rb': `class BaseController < ActionController::Base
  before_action :require_admin
end
`,
      'app/controllers/admin/base_controller.rb': `module Admin
  class BaseController < ActionController::Base
  end
end
`,
      'app/controllers/admin/users_controller.rb': `module Admin
  class UsersController < ::BaseController
    def index; end
  end
end
`,
    },
    covers: { 'Admin::UsersController#index': 'require_admin' },
  },
  {
    reason: 'the outer class of its own name it inherits from',
    files: {
      'app/controllers/users_controller.rb': `class UsersController < ApplicationController
  before_action :require_admin
end
`,
      'app/controllers/admin/users_controller.rb': `module Admin
  class UsersController < UsersController
    def index; end
  end
end
`,
    },
    covers: { 'Admin::UsersController#index': 'require_admin' },
  },
  {
    reason: 'its parents once each, when they name each other',
    files: {
      'app/controllers/base_controller.rb': `class BaseController < UsersController
  before_action :require_admin
end
`,
      'app/controllers/users_controller.rb': `class UsersController < BaseController
  skip_before_action :require_admin, only: :show
  def index; end
end
`,
    },
    covers: { 'UsersController#index': 'require_admin' },
  },
  {
    reason: "a concern's included callbacks",
    files: {
      'app/controllers/concerns/authorized.rb': `module Authorized
  extend ActiveSupport::Concern

  included do
    before_action :require_admin
  end
end
`,
      'app/controllers/admin/users_controller.rb': `module Admin
  class UsersController < ApplicationController
    include Authorized
    def index; end
  end
end
`,
    },
    covers: { 'Admin::UsersController#index': 'require_admin' },
  },
  {
    reason: 'nothing, when it skips a callback a concern gave it before',
    files: {
      'app/controllers/concerns/authorized.rb': `module Authorized
  included { before_action :require_admin }
end
`,
      'app/controllers/users_controller.rb': `class UsersController < ApplicationController
  include Authorized
  skip_before_action :require_admin
  def index; end
end
`,
    },
    covers: { 'UsersController#index': undefined },
  },
  {
    reason: 'the concern its lexical scope names first',
    files: {
      'app/controllers/concerns/authorized.rb': `module Authorized
end
`,
      'app/controllers/concerns/admin/authorized.rb': `module Admin
  module Authorized
    included { before_action :require_admin }
  end
end
`,
      'app/controllers/admin/users_controller.rb': `module Admin
  class UsersController < ApplicationController
    include Authorized
    def index; end
  end
end
`,
    },
    covers: { 'Admin::UsersController#index': 'require_admin' },
  },
  {
    reason: 'concerns once each, when they include each other',
    files: {
      'app/controllers/concerns/authorized.rb': `module Authorized
  included do
    include Audited
    before_action :require_admin
  end
end
`,
      'app/controllers/concerns/audited.rb': `module Audited
  included { include Authorized }
end
`,
      'app/controllers/users_controller.rb': `class UsersController < ApplicationController
  include Authorized
  def index; end
end
`,
    },
    covers: { 'UsersController#index': 'require_admin' },
  },
  {
    reason: 'nothing from a parent of the same name in another app',
    files: {
      'apps/a/app/controllers/application_controller.rb': `class ApplicationController < ActionController::Base
  before_action :require_admin
end
`,
      'apps/b/app/controllers/users_controller.rb': USERS,
    },
    covers: { 'UsersController#index': undefined },
  },
])('an action is covered by $reason', ({ files, covers }) => {
  expect(coversIn(files)).toStrictEqual(covers);
});

test('an action is covered by an authorize call in its own body', () => {
  expect(
    read({
      'app/controllers/users_controller.rb': `class UsersController < ApplicationController
  def show
    @user = User.find(params[:id])
    authorize @user
  end

  def index; end

  def edit
    verify_authorized
  end

  def self.index
    authorize User
  end
end
`,
    }).actions.map(({ action, cover }) => [action, cover]),
  ).toStrictEqual([
    ['show', { by: 'authorize', conditional: false }],
    ['index', undefined],
    ['edit', { by: 'verify_authorized', conditional: false }],
  ]);
});

test.for([
  { name: 'authenticate_*!', callback: 'authenticate_user!', by: 'authenticate_user!' },
  { name: 'require_admin', callback: 'require_admins' },
  { name: 'authenticate_*!', callback: 'reauthenticate_user!' },
  { name: 'admin?', callback: 'admi' },
])('the authorize name $name covers $callback: $by', ({ name, callback, by }) => {
  expect(
    read(
      {
        'app/controllers/users_controller.rb': `class UsersController < ApplicationController
  before_action :${callback}
  def index; end
end
`,
      },
      [name],
    ).actions.map(({ cover }) => cover?.by),
  ).toStrictEqual([by]);
});

test('a callback list it cannot read, or a block calling no authorize name, is unread, where it is written', () => {
  expect(
    read({
      'app/controllers/users_controller.rb': `class UsersController < ActionController::Base
  helper_method *HELPERS
  before_action :require_admin
  before_action *CALLBACKS, :set_user
  before_action { authorize User }
  before_action { head :forbidden unless admin? }
  def index; end
end
`,
    }).unread,
  ).toStrictEqual([
    {
      text: 'before_action *CALLBACKS, :set_user',
      file: 'app/controllers/users_controller.rb',
      line: 4,
    },
    {
      text: 'before_action { head :forbidden unless admin? }',
      file: 'app/controllers/users_controller.rb',
      line: 6,
    },
  ]);
});

test('a parent outside the controllers read is unread, where the class names it', () => {
  expect(
    read({
      'app/controllers/application_controller.rb': `class ApplicationController < ActionController::Base
end
`,
      'app/controllers/api/base_controller.rb': `module Api
  class BaseController < ActionController::API
  end
end
`,
      'app/controllers/users_controller.rb': USERS,
      'app/controllers/sessions_controller.rb': `module Accounts
  class SessionsController < Devise::SessionsController
    def new; end
  end
end
`,
      'app/controllers/admin/audits_controller.rb': `module Admin
  class AuditsController < AuditsController
  end
end
`,
    }).unread,
  ).toStrictEqual([
    {
      text: 'class SessionsController < Devise::SessionsController',
      file: 'app/controllers/sessions_controller.rb',
      line: 2,
    },
    {
      text: 'class AuditsController < AuditsController',
      file: 'app/controllers/admin/audits_controller.rb',
      line: 2,
    },
  ]);
});

test('an include naming a concern outside the controllers read is unread, where it is written', () => {
  expect(
    read({
      'app/controllers/concerns/authorized.rb': `module Authorized
  extend ActiveSupport::Concern
  included do
    include Pundit::Authorization
  end
end
`,
      'app/controllers/users_controller.rb': `class UsersController < ActionController::Base
  include Authorized, Pagy::Backend
  def index; end
end
`,
    }).unread,
  ).toStrictEqual([
    {
      text: 'include Pundit::Authorization',
      file: 'app/controllers/concerns/authorized.rb',
      line: 4,
    },
    {
      text: 'include Authorized, Pagy::Backend',
      file: 'app/controllers/users_controller.rb',
      line: 2,
    },
  ]);
});
