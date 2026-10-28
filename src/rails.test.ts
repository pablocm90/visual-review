import { rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { expect, test } from 'vitest';
import { readRange } from './read-range.ts';
import { commit, gitRepo } from './test-support/cargo-workspace.ts';

const railsApp = { 'config/application.rb': 'module Shop\n  class Application\n  end\nend\n' };

test('a Rails app at the root of the repo is a stack named by the repo, its classes in a box per app/ folder holding Ruby, and lib/', async () => {
  using workspace = gitRepo({
    ...railsApp,
    'app/models/order.rb': 'class Order\nend\n',
    'app/models/concerns/searchable.rb': 'module Searchable\nend\n',
    'app/controllers/admin/users_controller.rb':
      'module Admin\n  class UsersController\n  end\nend\n',
    'app/views/orders/index.html.erb': '<h1>Orders</h1>\n',
    'lib/money.rb': 'class Money\nend\n',
  });
  const { repo, root } = workspace;
  const shop = basename(repo);

  const range = await readRange({ repo, from: root, to: root });

  expect(range.after).toEqual({
    nodes: [
      { id: shop, kind: 'stack', label: shop, path: '' },
      {
        id: `${shop}/layer/controllers`,
        kind: 'module',
        label: 'controllers',
        parent: shop,
        path: 'app/controllers',
      },
      {
        id: `${shop}/class/Admin::UsersController`,
        kind: 'file',
        label: 'Admin::UsersController',
        parent: `${shop}/layer/controllers`,
        path: 'app/controllers/admin/users_controller.rb',
      },
      {
        id: `${shop}/layer/models`,
        kind: 'module',
        label: 'models',
        parent: shop,
        path: 'app/models',
      },
      {
        id: `${shop}/class/Searchable`,
        kind: 'file',
        label: 'Searchable',
        parent: `${shop}/layer/models`,
        path: 'app/models/concerns/searchable.rb',
      },
      {
        id: `${shop}/class/Order`,
        kind: 'file',
        label: 'Order',
        parent: `${shop}/layer/models`,
        path: 'app/models/order.rb',
      },
      { id: `${shop}/layer/lib`, kind: 'module', label: 'lib', parent: shop, path: 'lib' },
      {
        id: `${shop}/class/Money`,
        kind: 'file',
        label: 'Money',
        parent: `${shop}/layer/lib`,
        path: 'lib/money.rb',
      },
    ],
    edges: [],
  });
});

test('a class moved from one layer to another keeps its id, in its new box', async () => {
  using workspace = gitRepo({ ...railsApp, 'app/services/money.rb': 'class Money\nend\n' });
  const { repo, root } = workspace;
  const shop = basename(repo);
  rmSync(join(repo, 'app/services/money.rb'));
  const to = commit(repo, { 'app/models/money.rb': 'class Money\nend\n' });

  const range = await readRange({ repo, from: root, to });

  const money = (graph: typeof range.before) =>
    graph.nodes.find(node => node.id === `${shop}/class/Money`)?.parent;
  expect([money(range.before), money(range.after)]).toEqual([
    `${shop}/layer/services`,
    `${shop}/layer/models`,
  ]);
});
