import { rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { expect, test } from 'vitest';
import { readRange } from '../../core/read-range.ts';
import { commit, gitRepo } from '../../test-support/repos.ts';

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
  expect(range.after.nodes.map(node => node.id)).not.toContain(`${shop}/layer/services`);
});

test("a class is named by the class or module definition naming the longest tail of its path, so acronyms keep their case and an app's own autoload roots are no namespaces, and by its path when the file defines none", async () => {
  using workspace = gitRepo({
    ...railsApp,
    'app/services/api_client.rb': 'class APIClient\nend\n',
    'app/controllers/admin/api_controller.rb': 'module Admin\n  class APIController\n  end\nend\n',
    'app/controllers/admin/html_controller.rb': 'class Admin::HTMLController\nend\n',
    'app/models/order.rb': 'class OrderError < StandardError\nend\n\nclass Order\nend\n',
    'app/models/price.rb': 'Price = Struct.new(:cents)\n',
    'app/models/invoice.rb': 'def invoice\nend\n\nclass Invoice\nend\n',
    'app/topics/billing/controllers/billing/invoices_controller.rb':
      'module Billing\n  class InvoicesController\n  end\nend\n',
  });
  const { repo, root } = workspace;
  const shop = basename(repo);

  const range = await readRange({ repo, from: root, to: root });

  expect(range.after.nodes.filter(node => node.kind === 'file').map(node => node.id)).toEqual([
    `${shop}/class/Admin::APIController`,
    `${shop}/class/Admin::HTMLController`,
    `${shop}/class/Invoice`,
    `${shop}/class/Order`,
    `${shop}/class/Price`,
    `${shop}/class/APIClient`,
    `${shop}/class/Billing::InvoicesController`,
  ]);
});

test('two files defining one constant draw it once, from the first by path', async () => {
  using workspace = gitRepo({
    ...railsApp,
    'app/models/money.rb': 'class Money\nend\n',
    'lib/money.rb': 'class Money\nend\n',
  });
  const { repo, root } = workspace;
  const shop = basename(repo);

  const range = await readRange({ repo, from: root, to: root });

  expect(range.after.nodes.filter(node => node.kind === 'file')).toEqual([
    expect.objectContaining({ id: `${shop}/class/Money`, path: 'app/models/money.rb' }),
  ]);
});

test('a Rails app in a folder is a stack named by the folder, while apps under vendor/, node_modules/, test/ or spec/ are none', async () => {
  using workspace = gitRepo({
    'api/config/application.rb': railsApp['config/application.rb'],
    'api/app/models/order.rb': 'class Order\nend\n',
    'vendor/bundle/gem/config/application.rb': '',
    'node_modules/gem/config/application.rb': '',
    'engines/pay/test/dummy/config/application.rb': '',
    'engines/pay/spec/dummy/config/application.rb': '',
  });
  const { repo, root } = workspace;

  const range = await readRange({ repo, from: root, to: root });

  expect(range.after.nodes).toEqual([
    { id: 'api', kind: 'stack', label: 'api', path: '' },
    {
      id: 'api/layer/models',
      kind: 'module',
      label: 'models',
      parent: 'api',
      path: 'api/app/models',
    },
    {
      id: 'api/class/Order',
      kind: 'file',
      label: 'Order',
      parent: 'api/layer/models',
      path: 'api/app/models/order.rb',
    },
  ]);
});

test('a Rails app at the root whose id a TS stack at the root took is told apart by a suffix', async () => {
  using workspace = gitRepo({
    ...railsApp,
    'package.json': '{}\n',
    'src/index.ts': '',
    'app/models/order.rb': 'class Order\nend\n',
  });
  const { repo, root } = workspace;
  const shop = basename(repo);

  const range = await readRange({ repo, from: root, to: root });

  expect(range.after.nodes.map(node => node.id)).toContain(`${shop}~2/class/Order`);
});

test('the config adds a Rails app detection leaves out, under the id it gives', async () => {
  using workspace = gitRepo({
    'visual-review.config.json':
      '{"stacks": {"dummy": {"reader": "rails", "root": "test/dummy"}}}\n',
    'test/dummy/config/application.rb': railsApp['config/application.rb'],
    'test/dummy/app/models/order.rb': 'class Order\nend\n',
  });
  const { repo, root } = workspace;

  const range = await readRange({ repo, from: root, to: root });

  expect(range.after.nodes.map(node => [node.id, node.path])).toEqual([
    ['dummy', ''],
    ['dummy/layer/models', 'test/dummy/app/models'],
    ['dummy/class/Order', 'test/dummy/app/models/order.rb'],
  ]);
});

test('app/lib is a box of its own, apart from lib/', async () => {
  using workspace = gitRepo({
    ...railsApp,
    'app/lib/tokenizer.rb': 'class Tokenizer\nend\n',
    'lib/money.rb': 'class Money\nend\n',
  });
  const { repo, root } = workspace;
  const shop = basename(repo);

  const range = await readRange({ repo, from: root, to: root });

  expect(
    range.after.nodes.filter(node => node.kind !== 'stack').map(node => [node.id, node.path]),
  ).toEqual([
    [`${shop}/layer/app/lib`, 'app/lib'],
    [`${shop}/class/Tokenizer`, 'app/lib/tokenizer.rb'],
    [`${shop}/layer/lib`, 'lib'],
    [`${shop}/class/Money`, 'lib/money.rb'],
  ]);
});
