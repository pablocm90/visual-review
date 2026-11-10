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
        controllerPath: 'users',
        action: 'index',
        root: '',
        file: 'app/controllers/users_controller.rb',
        line: 2,
      },
    ],
  });
});

test("a concern's public methods are no actions of its own", () => {
  expect(
    read({
      'app/controllers/concerns/paging.rb': `module Paging
  def page_size; end
end
`,
    }),
  ).toStrictEqual({ actions: [] });
});

test.for([
  { written: 'Admin::UsersController', path: 'admin/users' },
  { written: 'OrderItemsController', path: 'order_items' },
  { written: 'HTMLPagesController', path: 'html_pages' },
  { written: 'Api::V2OrderItemsController', path: 'api/v2_order_items' },
])('$written is routed as $path', ({ written, path }) => {
  const [action] = read({
    'app/controllers/x_controller.rb': `class ${written} < ActionController::Base\n  def index; end\nend\n`,
  }).actions;
  expect(action?.controllerPath).toBe(path);
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

test.for([
  { body: '  load_and_authorize_resource', covers: ['index', 'show'] },
  { body: '  authorize_resource only: :show', covers: ['show'] },
  {
    body: '  load_and_authorize_resource\n  skip_load_and_authorize_resource only: :index',
    covers: ['show'],
  },
  { body: '  load_and_authorize_resource\n  skip_load_and_authorize_resource', covers: [] },
  {
    body: '  load_and_authorize_resource if: :signed_in?',
    covers: ['index', 'show'],
    conditional: true,
  },
])(
  'a class macro naming an authorize method, $body, covers $covers',
  ({ body, covers, conditional = false }) => {
    expect(
      read(
        {
          'app/controllers/users_controller.rb': `class UsersController < ApplicationController\n${body}\n  def index; end\n  def show; end\nend\n`,
        },
        ['load_and_authorize_resource', 'authorize_resource'],
      ).actions.flatMap(({ action, cover }) =>
        cover === undefined ? [] : [[action, cover.conditional]],
      ),
    ).toStrictEqual(covers.map(action => [action, conditional]));
  },
);

const REOPENED = {
  'app/controllers/users_controller.rb': `class UsersController < ApplicationController
  def show; end
end
`,
  'app/controllers/users_controller/extra.rb': `class UsersController
  skip_before_action :authorize, only: :extra
  def extra; end
end
`,
};

test.for([
  { order: 'parent first', files: REOPENED },
  { order: 'parent last', files: Object.fromEntries(Object.entries(REOPENED).reverse()) },
])('a reopened controller keeps what each of its definitions says, $order', ({ files }) => {
  expect(
    read({
      'app/controllers/application_controller.rb': `class ApplicationController < ActionController::Base
  before_action :authorize
end
`,
      ...files,
    })
      .actions.map(({ action, cover }) => [action, cover?.by])
      .sort(),
  ).toStrictEqual([
    ['extra', undefined],
    ['show', 'authorize'],
  ]);
});

test("a callback's options are no callbacks of their own", () => {
  expect(
    read(
      {
        'app/controllers/users_controller.rb': `class UsersController < ApplicationController
  before_action :load_user, if: :authorized?
  def index; end
end
`,
      },
      ['*authorized*'],
    ).actions.map(({ cover }) => cover),
  ).toStrictEqual([undefined]);
});

const unreadOf = (files: Record<string, string>) =>
  read(files).actions.map(({ action, unread }) => [
    action,
    unread?.map(({ text, file, line }) => [text, file, line]),
  ]);

test('a callback list it cannot read, or a block calling no authorize name, is unread, where it is written', () => {
  expect(
    unreadOf({
      'app/controllers/users_controller.rb': `class UsersController < ActionController::Base
  helper_method *HELPERS
  before_action :require_admin
  before_action *CALLBACKS, :set_user
  before_action { authorize User }
  before_action { head :forbidden unless admin? }
  def index; end
end
`,
    }),
  ).toStrictEqual([
    [
      'index',
      [
        ['before_action *CALLBACKS, :set_user', 'app/controllers/users_controller.rb', 4],
        [
          'before_action { head :forbidden unless admin? }',
          'app/controllers/users_controller.rb',
          6,
        ],
      ],
    ],
  ]);
});

test.for([
  { callback: '-> { authorize User }', by: 'authorize' },
  { callback: 'lambda { authorize User }', by: 'authorize' },
  { callback: '-> { head :forbidden }' },
  { callback: 'AdminOnly.new' },
  { callback: 'AuthorizeAdmin.new' },
])(
  'a callback given as $callback covers by $by, and is unread when it calls no authorize name',
  ({ callback, by }) => {
    const line = `  before_action ${callback}`;
    const [action] = read(
      {
        'app/controllers/users_controller.rb': `class UsersController < ActionController::Base\n${line}\n  def index; end\nend\n`,
      },
      [...PUNDIT, 'Authorize*'],
    ).actions;
    expect([action?.cover?.by, action?.unread?.map(({ text }) => text)]).toStrictEqual(
      by === undefined ? [undefined, [line.trim()]] : [by, undefined],
    );
  },
);

test.for([
  { option: 'only: %i[index show]', unread: false },
  { option: "only: [:index, 'show']", unread: false },
  { option: 'except: :show', unread: false },
  { option: 'only: %w[index]', unread: false },
  { option: 'except: PUBLIC', unread: true },
  { option: 'only: actions', unread: true },
  { option: 'only: [*AUTHED, :index]', unread: true },
  { option: 'only: %I[#{name}]', unread: true },
  { option: 'except: "a#{name}"', unread: true },
])('a callback given $option is unread: $unread', ({ option, unread }) => {
  const line = `  before_action :authorize, ${option}`;
  expect(
    unreadOf({
      'app/controllers/users_controller.rb': `class UsersController < ActionController::Base\n${line}\n  def index; end\nend\n`,
    }),
  ).toStrictEqual([
    ['index', unread ? [[line.trim(), 'app/controllers/users_controller.rb', 2]] : undefined],
  ]);
});

test('an unread callback written over several lines is named by its first', () => {
  expect(
    unreadOf({
      'app/controllers/users_controller.rb': `class UsersController < ActionController::Base
  before_action do
    head :forbidden unless admin?
  end
  def index; end
end
`,
    }),
  ).toStrictEqual([['index', [['before_action do', 'app/controllers/users_controller.rb', 2]]]]);
});

test('a parent outside the controllers read is unread, where the class names it', () => {
  expect(
    unreadOf({
      'app/controllers/application_controller.rb': `class ApplicationController < ActionController::Base
end
`,
      'app/controllers/api/base_controller.rb': `module Api
  class BaseController < ActionController::API
    def index; end
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
    def show; end
  end
end
`,
    }),
  ).toStrictEqual([
    ['index', undefined],
    ['index', undefined],
    [
      'new',
      [
        [
          'class SessionsController < Devise::SessionsController',
          'app/controllers/sessions_controller.rb',
          2,
        ],
      ],
    ],
    [
      'show',
      [
        [
          'class AuditsController < AuditsController',
          'app/controllers/admin/audits_controller.rb',
          2,
        ],
      ],
    ],
  ]);
});

test('an include naming a concern outside the controllers read is unread, where it is written', () => {
  expect(
    unreadOf({
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
    }),
  ).toStrictEqual([
    [
      'index',
      [
        ['include Pundit::Authorization', 'app/controllers/concerns/authorized.rb', 4],
        ['include Authorized, Pagy::Backend', 'app/controllers/users_controller.rb', 2],
      ],
    ],
  ]);
});

test("an action carries the unread rows its cover was read through, its parents' and concerns' too, and no other controller's", () => {
  const { actions } = read({
    'app/controllers/application_controller.rb': `class ApplicationController < ActionController::Base
  before_action *GLOBAL
end
`,
    'app/controllers/concerns/audited.rb': `module Audited
  extend ActiveSupport::Concern
  included do
    before_action { head :forbidden unless admin? }
  end
end
`,
    'app/controllers/users_controller.rb': `class UsersController < ApplicationController
  include Audited
  before_action *USERS
  def index; end
end
`,
    'app/controllers/reports_controller.rb': `class ReportsController < ActionController::Base
  before_action *REPORTS
  def show; end
end
`,
  });

  expect(
    actions.map(({ action, unread }) => [action, unread?.map(({ text, file }) => [text, file])]),
  ).toStrictEqual([
    [
      'index',
      [
        ['before_action *GLOBAL', 'app/controllers/application_controller.rb'],
        ['before_action { head :forbidden unless admin? }', 'app/controllers/concerns/audited.rb'],
        ['before_action *USERS', 'app/controllers/users_controller.rb'],
      ],
    ],
    ['show', [['before_action *REPORTS', 'app/controllers/reports_controller.rb']]],
  ]);
});

test('a controller that does not parse is named, and the others still read', () => {
  expect(
    read({
      'app/controllers/broken_controller.rb':
        'class BrokenController < ActionController::Base\n  def index(\nend\n',
      'app/controllers/users_controller.rb':
        'class UsersController < ActionController::Base\n  def index; end\nend\n',
    }),
  ).toMatchObject({
    actions: [{ controller: 'UsersController', action: 'index' }],
    notRead: [{ file: 'app/controllers/broken_controller.rb', reason: 'Ruby that does not parse' }],
  });
});
