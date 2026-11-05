import { expect, test } from 'vitest';
import type { Route } from '../../core/routes.ts';
import { railsRoutes } from './route-reader.ts';

const drawing = (body: string) => `Rails.application.routes.draw do
  ${body}
end
`;

const read = (body: string) => railsRoutes.routes(new Map([['config/routes.rb', drawing(body)]]));

const lines = (body: string) =>
  read(body).routes.map(({ verb, path, target }) => `${verb} ${path} ${target}`);

test('resources draws its seven actions, update under both verbs', () => {
  expect(lines('resources :users')).toStrictEqual([
    'GET /users users#index',
    'POST /users users#create',
    'GET /users/new users#new',
    'GET /users/:id/edit users#edit',
    'GET /users/:id users#show',
    'PATCH /users/:id users#update',
    'PUT /users/:id users#update',
    'DELETE /users/:id users#destroy',
  ]);
});

test('a route says which file and line drew it', () => {
  const [route] = read('resources :users').routes;
  expect(route).toMatchObject({ file: 'config/routes.rb', line: 2 });
});

const targets = (body: string) => read(body).routes.map(({ target }) => target);

test.for([
  { written: 'resources :users, only: :index', expected: ['users#index'] },
  { written: 'resources :users, only: [:index, :show]', expected: ['users#index', 'users#show'] },
  { written: 'resources :users, only: %i[index]', expected: ['users#index'] },
  { written: 'resources :users, only: []', expected: [] },
  {
    written: 'resources :users, except: [:new, :edit, :update, :destroy, :show]',
    expected: ['users#index', 'users#create'],
  },
  { written: 'resources :users, :only => :index', expected: ['users#index'] },
])('$written keeps only the actions it names', ({ written, expected }) => {
  expect(targets(written)).toStrictEqual(expected);
});

test('resources names several, each with its own actions', () => {
  expect(targets('resources :users, :posts, only: :index')).toStrictEqual([
    'users#index',
    'posts#index',
  ]);
});

test('resource draws one thing with no index and no id, its controller plural', () => {
  expect(lines('resource :profile')).toStrictEqual([
    'POST /profile profiles#create',
    'GET /profile/new profiles#new',
    'GET /profile/edit profiles#edit',
    'GET /profile profiles#show',
    'PATCH /profile profiles#update',
    'PUT /profile profiles#update',
    'DELETE /profile profiles#destroy',
  ]);
});

test.for([
  { written: 'resource :profile, only: :show', expected: ['GET /profile profiles#show'] },
  { written: 'resource :profile, only: []', expected: [] },
])('$written keeps its actions as resources does', ({ written, expected }) => {
  expect(lines(written)).toStrictEqual(expected);
});

test('namespace prefixes the path and the controller, nesting', () => {
  expect(
    lines(`namespace :api do
      namespace :v1 do
        resources :users, only: :index
      end
    end`),
  ).toStrictEqual(['GET /api/v1/users api/v1/users#index']);
});

test.for([
  {
    reads: 'resources inside resources',
    written: `resources :templates, only: [] do
      resources :bodies, only: :index
    end`,
    expected: ['GET /templates/:template_id/bodies bodies#index'],
  },
  {
    reads: 'its parent named singular as ActiveSupport does',
    written: `resources :statuses, only: [] do
      resources :bodies, only: :index
    end`,
    expected: ['GET /statuses/:status_id/bodies bodies#index'],
  },
  {
    reads: 'resources inside a resource',
    written: `resource :profile, only: [] do
      resources :posts, only: :index
    end`,
    expected: ['GET /profile/posts posts#index'],
  },
  {
    reads: 'the parent routes kept beside it',
    written: `resources :templates, only: :index do
      resources :bodies, only: :index
    end`,
    expected: ['GET /templates templates#index', 'GET /templates/:template_id/bodies bodies#index'],
  },
  {
    reads: 'a module carried in',
    written: `namespace :api do
      resources :templates, only: [] do
        resources :bodies, only: :index
      end
    end`,
    expected: ['GET /api/templates/:template_id/bodies api/bodies#index'],
  },
])('nesting reads $reads', ({ written, expected }) => {
  expect(lines(written)).toStrictEqual(expected);
});

test.for([
  { verb: 'get', drawn: 'GET' },
  { verb: 'post', drawn: 'POST' },
  { verb: 'put', drawn: 'PUT' },
  { verb: 'patch', drawn: 'PATCH' },
  { verb: 'delete', drawn: 'DELETE' },
])('$verb in a member block draws $drawn', ({ verb, drawn }) => {
  expect(
    lines(`resources :templates, only: [] do
      member do
        ${verb} "logs"
      end
    end`),
  ).toStrictEqual([`${drawn} /templates/:id/logs templates#logs`]);
});

test.for([
  {
    reads: 'a collection block',
    inner: 'collection do\n put "order"\n end',
    on: '/templates/order',
  },
  { reads: 'on: :member', inner: 'put "order", on: :member', on: '/templates/:id/order' },
  { reads: 'on: :collection', inner: 'put "order", on: :collection', on: '/templates/order' },
  { reads: 'no block, nested', inner: 'put "order"', on: '/templates/:template_id/order' },
])('a verb in resources sits by $reads', ({ inner, on }) => {
  expect(
    lines(`resources :templates, only: [] do
      ${inner}
    end`),
  ).toStrictEqual([`PUT ${on} templates#order`]);
});

test.for([
  { reads: 'a member block', inner: 'member do\n get "logs"\n end' },
  { reads: 'a collection block', inner: 'collection do\n get "logs"\n end' },
  { reads: 'no block', inner: 'get "logs"' },
])('a verb in a resource has no id, by $reads', ({ inner }) => {
  expect(
    lines(`resource :profile, only: [] do
      ${inner}
    end`),
  ).toStrictEqual(['GET /profile/logs profiles#logs']);
});

test.for([
  { written: 'get "names", to: "views#names"', expected: 'GET /names views#names' },
  { written: 'get "names", :to => "views#names"', expected: 'GET /names views#names' },
  {
    written: 'get "/auth/failure" => "auth0#failure"',
    expected: 'GET /auth/failure auth0#failure',
  },
  {
    written: 'get "/auth/callback" => "auth0#callback", :as => "auth_callback"',
    expected: 'GET /auth/callback auth0#callback',
  },
  { written: 'get "/signup", to: redirect("/join")', expected: 'GET /signup redirect("/join")' },
  { written: 'get "reports/monthly"', expected: 'GET /reports/monthly reports#monthly' },
  {
    written: 'get "sync-health/all-of-it"',
    expected: 'GET /sync-health/all-of-it sync_health#all_of_it',
  },
  { written: 'get "names", controller: :views, action: :list', expected: 'GET /names views#list' },
  {
    written: 'get :public_show, path: "demo", controller: :pages',
    expected: 'GET /demo pages#public_show',
  },
])('$written targets as written', ({ written, expected }) => {
  expect(lines(written)).toStrictEqual([expected]);
});

test.for([
  {
    reads: 'a module on to:',
    written: `namespace :api do
      get "names", to: "views#names"
    end`,
    expected: 'GET /api/names api/views#names',
  },
  {
    reads: 'a module on a rocket',
    written: `namespace :api do
      get "names" => "views#names"
    end`,
    expected: 'GET /api/names api/views#names',
  },
  {
    reads: 'an action named to: in a resource',
    written: `resources :users, only: [] do
      get "names", to: "list", on: :collection
    end`,
    expected: 'GET /users/names users#list',
  },
  {
    reads: 'a controller path to: in a resource',
    written: `resources :users, only: [] do
      post "hooks", to: "users/hooks#create", on: :collection
    end`,
    expected: 'POST /users/hooks users/hooks#create',
  },
  {
    reads: 'a dashed name, as its action with underscores',
    written: `resources :users, only: [] do
      get "all-names", on: :collection
    end`,
    expected: 'GET /users/all-names users#all_names',
  },
  {
    reads: 'path: over the name',
    written: `resources :users, only: [] do
      post :generate_draft, path: "generate-draft", on: :member
    end`,
    expected: 'POST /users/:id/generate-draft users#generate_draft',
  },
  {
    reads: 'a leading slash joined once',
    written: `namespace :api do
      get "/names", to: "views#names"
    end`,
    expected: 'GET /api/names api/views#names',
  },
])('a verb reads $reads', ({ written, expected }) => {
  expect(lines(written)).toStrictEqual([expected]);
});

test.for([
  {
    written: 'scope "/:locale", locale: /en|fr/ do\n resources :users, only: :index\n end',
    expected: 'GET /:locale/users users#index',
  },
  {
    written: 'scope "terms/:terms_id" do\n resources :users, only: :index\n end',
    expected: 'GET /terms/:terms_id/users users#index',
  },
  {
    written: 'scope path: "admin" do\n resources :users, only: :index\n end',
    expected: 'GET /admin/users users#index',
  },
  {
    written: 'scope module: :backoffice do\n resources :users, only: :index\n end',
    expected: 'GET /users backoffice/users#index',
  },
  {
    written: 'scope "health", controller: :checks do\n get :sleeping, path: "slow"\n end',
    expected: 'GET /health/slow checks#sleeping',
  },
  {
    written: 'scope as: :admin do\n resources :users, only: :index\n end',
    expected: 'GET /users users#index',
  },
  {
    written: 'namespace :admin, path: "back" do\n resources :users, only: :index\n end',
    expected: 'GET /back/users admin/users#index',
  },
  {
    written: 'namespace :admin, module: :staff do\n resources :users, only: :index\n end',
    expected: 'GET /admin/users staff/users#index',
  },
  {
    written:
      'namespace :api, defaults: { format: :json } do\n resources :users, only: :index\n end',
    expected: 'GET /api/users api/users#index',
  },
  {
    written: 'resources :users, only: :index, path: "people/all"',
    expected: 'GET /people/all users#index',
  },
  {
    written: 'resources :users, only: :index, controller: "members"',
    expected: 'GET /users members#index',
  },
  {
    written: 'resource :profile, only: :show, controller: "profile"',
    expected: 'GET /profile profile#show',
  },
  {
    written: 'resources :users, only: :index, module: :staff',
    expected: 'GET /users staff/users#index',
  },
  {
    written: 'resources :views, only: :show, param: :view_type',
    expected: 'GET /views/:view_type views#show',
  },
])('$written reads its options', ({ written, expected }) => {
  expect(lines(written)).toStrictEqual([expected]);
});

test.for([
  {
    reads: 'a nested one named after param:',
    inner: 'resources :posts, only: :index',
    expected: 'GET /views/:view_view_type/posts posts#index',
  },
  {
    reads: 'a member verb named by param:',
    inner: 'get "logs", on: :member',
    expected: 'GET /views/:view_type/logs views#logs',
  },
])('param: gives $reads', ({ inner, expected }) => {
  expect(
    lines(`resources :views, only: [], param: :view_type do
      ${inner}
    end`),
  ).toStrictEqual([expected]);
});

test.for([
  {
    reads: 'path: carries under it',
    written: 'resources :users, only: [], path: "people" do\n get "logs", on: :collection\n end',
    expected: 'GET /people/logs users#logs',
  },
  {
    reads: 'controller: carries under it',
    written:
      'resources :users, only: [], controller: "members" do\n get "logs", on: :collection\n end',
    expected: 'GET /users/logs members#logs',
  },
  {
    reads: 'module: carries under it',
    written: 'resources :users, only: [], module: :staff do\n get "logs", on: :collection\n end',
    expected: 'GET /users/logs staff/users#logs',
  },
])('$reads', ({ written, expected }) => {
  expect(lines(written)).toStrictEqual([expected]);
});

test.for([
  { written: 'root "home#index"', expected: ['GET / home#index'] },
  { written: 'root to: "home#index"', expected: ['GET / home#index'] },
  { written: 'root to: redirect("/join")', expected: ['GET / redirect("/join")'] },
  {
    written: 'namespace :api do\n root "home#index"\n end',
    expected: ['GET /api api/home#index'],
  },
  {
    written: 'match "a", to: "b#c", via: [:get, :post]',
    expected: ['GET /a b#c', 'POST /a b#c'],
  },
  { written: 'match "a", to: "b#c", via: :get', expected: ['GET /a b#c'] },
  { written: 'match "a", to: "b#c", via: :all', expected: ['ANY /a b#c'] },
  { written: 'mount Sidekiq::Web => "/sidekiq"', expected: ['ANY /sidekiq Sidekiq::Web'] },
  { written: 'mount Blog::Engine, at: "blog"', expected: ['ANY /blog Blog::Engine'] },
  {
    written: 'namespace :api do\n mount Blog::Engine, at: "/blog"\n end',
    expected: ['ANY /api/blog Blog::Engine'],
  },
  {
    written: 'constraints(Auth) do\n resources :users, only: :index\n end',
    expected: ['GET /users users#index'],
  },
  {
    written: 'defaults format: :json do\n resources :users, only: :index\n end',
    expected: ['GET /users users#index'],
  },
  { written: 'resources :pages, only: :index, path: ""', expected: ['GET / pages#index'] },
  {
    written: 'resources :pages, only: [], path: "" do\n get "about", on: :collection\n end',
    expected: ['GET /about pages#about'],
  },
])('$written draws what it says', ({ written, expected }) => {
  expect(lines(written)).toStrictEqual(expected);
});

test.for([
  { reads: 'a condition', written: 'if Rails.env.test?\n get "a", to: "b#c"\n end' },
  { reads: 'a loop', written: '%w[a b].each do |name|\n get name, to: "b#c"\n end' },
  { reads: 'a call it does not know', written: 'devise_for :users' },
  { reads: 'a concern', written: 'concern :commentable do\n resources :comments\n end' },
  { reads: 'a name it cannot read', written: 'resources NAME' },
  { reads: 'a splatted name', written: 'resources(*NAMES)' },
  { reads: 'an interpolated name', written: 'get "#{prefix}/a", to: "b#c"' },
  { reads: 'an only it cannot read', written: 'resources :users, only: ACTIONS' },
  { reads: 'an except it cannot read', written: 'resources :users, except: ACTIONS' },
  { reads: 'a splatted option', written: 'resources :users, **options' },
  { reads: 'shallow', written: 'resources :users, shallow: true' },
  { reads: 'concerns', written: 'resources :users, concerns: :commentable' },
  { reads: 'path_names', written: 'resources :users, path_names: { new: "make" }' },
  { reads: 'a path it cannot read', written: 'resources :users, path: PATH' },
  { reads: 'a controller it cannot read', written: 'resources :users, controller: NAME' },
  { reads: 'a namespace it cannot read', written: 'namespace NAME do\n get "a", to: "b#c"\n end' },
  { reads: 'a scope it cannot read', written: 'scope PATH do\n get "a", to: "b#c"\n end' },
  { reads: 'an interpolated to:', written: 'get "a", to: "#{name}#c"' },
  { reads: 'an interpolated rocket', written: 'get "a" => "#{name}#c"' },
  { reads: 'a new block', written: 'resources :users, only: [] do\n new do\n get "a"\n end\n end' },
  { reads: 'on: :new', written: 'resources :users, only: [] do\n get "a", on: :new\n end' },
  { reads: 'a verb with no controller', written: 'get "a"' },
  {
    reads: 'a dynamic path with no action',
    written: 'scope controller: :b do\n get "a/:id"\n end',
  },
  { reads: 'match with no via', written: 'match "a", to: "b#c"' },
  { reads: 'root with no target', written: 'root' },
])('$reads is not read, and not guessed at', ({ written }) => {
  const { routes, unread } = read(written);
  expect(routes).toStrictEqual([]);
  expect(unread).toHaveLength(1);
});

test('what is not read keeps its source on one line, its file and its line', () => {
  expect(
    read('resources :users, only: :index\n  if flag\n    get "a"\n  end').unread,
  ).toStrictEqual([{ text: 'if flag get "a" end', file: 'config/routes.rb', line: 3 }]);
});

test('a brace block reads as a do block', () => {
  expect(lines('namespace(:api) { resources :users, only: :index }')).toStrictEqual([
    'GET /api/users api/users#index',
  ]);
});

const readFiles = (entries: ReadonlyArray<readonly [string, string]>) =>
  railsRoutes.routes(new Map(entries));

const linesOf = (table: { readonly routes: ReadonlyArray<Route> }) =>
  table.routes.map(({ verb, path, target }) => `${verb} ${path} ${target}`);

test.for([
  {
    reads: 'load of Rails.root.join with a draw of its own',
    root: 'load Rails.root.join("config/routes/admin.rb")',
    other: 'config/routes/admin.rb',
    text: drawing('resources :users, only: :index'),
  },
  {
    reads: 'load joining several parts',
    root: 'load Rails.root.join("config", "routes", "admin.rb")',
    other: 'config/routes/admin.rb',
    text: drawing('resources :users, only: :index'),
  },
  {
    reads: 'draw with a symbol, of a file with no draw of its own',
    root: 'draw :admin',
    other: 'config/routes/admin.rb',
    text: 'resources :users, only: :index\n',
  },
  {
    reads: 'draw with a string, in a folder',
    root: 'draw("back/admin")',
    other: 'config/routes/back/admin.rb',
    text: 'resources :users, only: :index\n',
  },
  {
    reads: 'a require beside the draw, left alone',
    root: 'load Rails.root.join("config/routes/admin.rb")',
    other: 'config/routes/admin.rb',
    text: `require "sidekiq/web"\n${drawing('resources :users, only: :index')}`,
  },
])('$reads joins the file in', ({ root, other, text }) => {
  const table = readFiles([
    ['config/routes.rb', drawing(root)],
    [other, text],
  ]);
  expect(linesOf(table)).toStrictEqual(['GET /users users#index']);
  expect(table.unread).toStrictEqual([]);
});

test('a followed file takes the prefix it was drawn under, and names its own lines', () => {
  const { routes } = readFiles([
    ['config/routes.rb', drawing('namespace :api do\n draw :admin\n end')],
    ['config/routes/admin.rb', '\nresources :users, only: :index\n'],
  ]);
  expect(routes).toMatchObject([
    { path: '/api/users', target: 'api/users#index', file: 'config/routes/admin.rb', line: 2 },
  ]);
});

test('a file nothing draws is not routes', () => {
  expect(
    readFiles([
      ['config/routes.rb', drawing('resources :users, only: :index')],
      ['config/routes/old.rb', drawing('resources :old, only: :index')],
    ]).routes,
  ).toHaveLength(1);
});

test('each config/routes.rb is its own root, drawing its own files', () => {
  expect(
    linesOf(
      readFiles([
        ['apps/a/config/routes.rb', drawing('draw :admin')],
        ['apps/a/config/routes/admin.rb', 'resources :users, only: :index\n'],
      ]),
    ),
  ).toStrictEqual(['GET /users users#index']);
});

test.for([
  { reads: 'a file that is not there', entries: [] },
  {
    reads: 'a file drawing itself',
    entries: [['config/routes/admin.rb', 'draw :admin\n']],
  },
] as const)('$reads is not read', ({ entries }) => {
  const { routes, unread } = readFiles([['config/routes.rb', drawing('draw :admin')], ...entries]);
  expect(routes).toStrictEqual([]);
  expect(unread.map(({ text }) => text)).toStrictEqual(['draw :admin']);
});

test.for([
  { reads: 'a path it cannot read', written: 'load path' },
  { reads: 'a load of something else', written: 'load File.join("a", "b.rb")' },
  { reads: 'a draw it cannot name', written: 'draw name' },
])('$reads is not read', ({ written }) => {
  expect(read(written).unread).toHaveLength(1);
});

test('a file that does not parse throws, so it is reported rather than read as no routes', () => {
  expect(() => read('resources :users,')).toThrow('Ruby syntax error');
});

test.for([
  { path: 'config/routes.rb', holds: true },
  { path: 'apps/a/config/routes.rb', holds: true },
  { path: 'config/routes/admin.rb', holds: true },
  { path: 'config/routes/back/admin.rb', holds: true },
  { path: 'config/routes/admin.txt', holds: false },
  { path: 'config/routes.txt', holds: false },
  { path: 'myconfig/routes.rb', holds: false },
  { path: 'vendor/gem/config/routes.rb', holds: false },
  { path: 'test/dummy/config/routes.rb', holds: false },
])('holds $path: $holds', ({ path, holds }) => {
  expect(railsRoutes.holds(path)).toBe(holds);
});
