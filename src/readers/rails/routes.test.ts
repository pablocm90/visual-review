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
