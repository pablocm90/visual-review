import { expect, test } from 'vitest';
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
