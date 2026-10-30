import { rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { expect, test } from 'vitest';
import { readRange } from '../../test-support/read-range.ts';
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

test("a constant a class writes draws an edge to the app's class it names, while its own name and constants naming no class of the app draw none", async () => {
  using workspace = gitRepo({
    ...railsApp,
    'app/models/order.rb': 'class Order\n  def self.recent = Order.where(recent: true)\nend\n',
    'app/controllers/orders_controller.rb':
      'class OrdersController\n  def index\n    Rails.logger.info(JSON.dump(Stripe::Charge.list))\n  end\nend\n',
  });
  const { repo, root } = workspace;
  const shop = basename(repo);
  const to = commit(repo, {
    'app/controllers/orders_controller.rb':
      'class OrdersController\n  def show\n    Order.find(params[:id])\n  end\nend\n',
  });

  const range = await readRange({ repo, from: root, to });

  expect([range.before.edges, range.after.edges]).toEqual([
    [],
    [{ from: `${shop}/class/OrdersController`, to: `${shop}/class/Order` }],
  ]);
});

test("the constants a file's class and module lines define are no references, so a class draws no edge to the app's module it is nested in", async () => {
  using workspace = gitRepo({
    ...railsApp,
    'app/models/billing.rb': 'module Billing\n  def self.table_name_prefix = "billing_"\nend\n',
    'app/models/billing/invoice.rb': 'module Billing\n  class Invoice\n  end\nend\n',
  });
  const { repo, root } = workspace;

  const range = await readRange({ repo, from: root, to: root });

  expect(range.after.edges).toEqual([]);
});

test('a scoped constant a class writes names the class it reads in whole, not the classes its parts name', async () => {
  using workspace = gitRepo({
    ...railsApp,
    'app/models/user.rb': 'class User\nend\n',
    'app/models/admin.rb': 'module Admin\nend\n',
    'app/models/admin/user.rb': 'module Admin\n  class User\n  end\nend\n',
    'app/controllers/reports_controller.rb':
      'class ReportsController\n  def index = Admin::User.count\nend\n',
  });
  const { repo, root } = workspace;
  const shop = basename(repo);

  const range = await readRange({ repo, from: root, to: root });

  expect(range.after.edges).toEqual([
    { from: `${shop}/class/ReportsController`, to: `${shop}/class/Admin::User` },
  ]);
});

test('a class draws one edge to each class it writes, in the order it first writes them', async () => {
  using workspace = gitRepo({
    ...railsApp,
    'app/models/money.rb': 'class Money\nend\n',
    'app/models/order.rb': 'class Order\nend\n',
    'app/controllers/checkout_controller.rb':
      'class CheckoutController\n  def create\n    Money.new(Order.find(1).total - Money.zero)\n  end\nend\n',
  });
  const { repo, root } = workspace;
  const shop = basename(repo);

  const range = await readRange({ repo, from: root, to: root });

  expect(range.after.edges).toEqual([
    { from: `${shop}/class/CheckoutController`, to: `${shop}/class/Money` },
    { from: `${shop}/class/CheckoutController`, to: `${shop}/class/Order` },
  ]);
});

test.for([
  {
    reason: 'in its nested scope first',
    controller: 'module Admin\n  class UsersController\n    def index = User.all\n  end\nend\n',
    to: 'Admin::User',
  },
  {
    reason: 'in its innermost scope first',
    controller: 'module Admin\n  class UsersController\n    def index = Filter.new\n  end\nend\n',
    to: 'Admin::UsersController::Filter',
  },
  {
    reason: 'in the one scope a compact class line opens',
    controller: 'class Admin::UsersController\n  def index = User.all\nend\n',
    to: 'User',
  },
  {
    reason: 'at the top only, written from the top',
    controller: 'module Admin\n  class UsersController\n    def index = ::User.all\n  end\nend\n',
    to: 'User',
  },
  {
    reason: 'by the longest part of it that is a class',
    controller:
      'module Admin\n  class UsersController\n    def index = Order::STATUSES\n  end\nend\n',
    to: 'Order',
  },
  {
    reason: 'by the longest part of it that is a class, in its nested scope first',
    controller: 'module Admin\n  class UsersController\n    def index = User::ROLES\n  end\nend\n',
    to: 'Admin::User',
  },
])('a constant names the class it resolves to $reason', async ({ controller, to }) => {
  using workspace = gitRepo({
    ...railsApp,
    'app/models/user.rb': 'class User\nend\n',
    'app/models/admin/user.rb': 'module Admin\n  class User\n  end\nend\n',
    'app/models/order.rb': 'class Order\nend\n',
    'app/models/admin/filter.rb': 'module Admin\n  class Filter\n  end\nend\n',
    'app/controllers/admin/users_controller/filter.rb':
      'module Admin\n  class UsersController\n    class Filter\n    end\n  end\nend\n',
    'app/controllers/admin/users_controller.rb': controller,
  });
  const { repo, root } = workspace;
  const shop = basename(repo);

  const range = await readRange({ repo, from: root, to: root });

  expect(range.after.edges).toEqual([
    { from: `${shop}/class/Admin::UsersController`, to: `${shop}/class/${to}` },
  ]);
});

test.for([
  { association: 'has_many :line_items', to: 'LineItem' },
  { association: 'has_and_belongs_to_many :skills', to: 'Skill' },
  { association: 'has_one :invoice', to: 'Invoice' },
  { association: 'belongs_to :address', to: 'Address' },
  { association: 'has_many :ai_calls', to: 'AICall' },
  { association: 'has_many :categories', to: 'Category' },
  { association: 'has_many :addresses', to: 'Address' },
  { association: 'has_many :taxes', to: 'Tax' },
  { association: 'has_many :batches', to: 'Batch' },
  { association: 'has_many :wishes', to: 'Wish' },
  { association: 'has_many :contact_people', to: 'ContactPerson' },
  { association: 'has_one :status', to: 'Status' },
  { association: 'has_many :billing_line', to: 'BillingLine' },
])('a model declaring $association draws an edge to $to', async ({ association, to }) => {
  using workspace = gitRepo({
    ...railsApp,
    'app/models/order.rb': `class Order\n  ${association}\nend\n`,
    'app/models/line_item.rb': 'class LineItem\nend\n',
    'app/models/skill.rb': 'class Skill\nend\n',
    'app/models/invoice.rb': 'class Invoice\nend\n',
    'app/models/ai_call.rb': 'class AICall\nend\n',
    'app/models/category.rb': 'class Category\nend\n',
    'app/models/address.rb': 'class Address\nend\n',
    'app/models/tax.rb': 'class Tax\nend\n',
    'app/models/batch.rb': 'class Batch\nend\n',
    'app/models/wish.rb': 'class Wish\nend\n',
    'app/models/contact_person.rb': 'class ContactPerson\nend\n',
    'app/models/status.rb': 'class Status\nend\n',
    'app/models/billing_line.rb': 'class BillingLine\nend\n',
  });
  const { repo, root } = workspace;
  const shop = basename(repo);

  const range = await readRange({ repo, from: root, to: root });

  expect(range.after.edges).toEqual([{ from: `${shop}/class/Order`, to: `${shop}/class/${to}` }]);
});

test.for([
  { association: 'has_many :items' },
  { association: 'has_many :things, class_name: "Item"' },
])(
  "$association names the class in its owner's scope first, even from a compact class line",
  async ({ association }) => {
    using workspace = gitRepo({
      ...railsApp,
      'app/models/admin/order.rb': `class Admin::Order\n  ${association}\nend\n`,
      'app/models/item.rb': 'class Item\nend\n',
      'app/models/admin/item.rb': 'module Admin\n  class Item\n  end\nend\n',
    });
    const { repo, root } = workspace;
    const shop = basename(repo);

    const range = await readRange({ repo, from: root, to: root });

    expect(range.after.edges).toEqual([
      { from: `${shop}/class/Admin::Order`, to: `${shop}/class/Admin::Item` },
    ]);
  },
);

test.for([
  { association: 'belongs_to :buyer, class_name: "User"', to: 'User' },
  {
    association: 'has_many :drafts, -> { where(draft: true) }, class_name: "Invoice"',
    to: 'Invoice',
  },
  { association: 'has_many :terms, class_name: "TermsAndConditions"', to: 'TermsAndConditions' },
  {
    association: 'has_many :payments, through: :lines, source: :item, source_type: "Invoice"',
    to: 'Invoice',
  },
  { association: 'has_many :reviewers, through: :reviews, source: :users', to: 'User' },
  {
    association: 'has_many :buyers, through: :carts, source: :customer, class_name: "User"',
    to: 'User',
  },
])(
  'a model declaring $association draws an edge to the class it names',
  async ({ association, to }) => {
    using workspace = gitRepo({
      ...railsApp,
      'app/models/order.rb': `class Order\n  ${association}\nend\n`,
      'app/models/user.rb': 'class User\nend\n',
      'app/models/invoice.rb': 'class Invoice\nend\n',
      'app/models/terms_and_conditions.rb': 'class TermsAndConditions\nend\n',
      'app/models/item.rb': 'class Item\nend\n',
      'app/models/payment.rb': 'class Payment\nend\n',
      'app/models/customer.rb': 'class Customer\nend\n',
    });
    const { repo, root } = workspace;
    const shop = basename(repo);

    const range = await readRange({ repo, from: root, to: root });

    expect(range.after.edges).toEqual([{ from: `${shop}/class/Order`, to: `${shop}/class/${to}` }]);
  },
);

test('a polymorphic association draws no edge, even when a class bears its name', async () => {
  using workspace = gitRepo({
    ...railsApp,
    'app/models/comment.rb': 'class Comment\n  belongs_to :commentable, polymorphic: true\nend\n',
    'app/models/concerns/commentable.rb': 'module Commentable\nend\n',
  });
  const { repo, root } = workspace;

  const range = await readRange({ repo, from: root, to: root });

  expect(range.after.edges).toEqual([]);
});

test("edges onto the base classes Rails generates are dropped, while edges onto an app's own base classes stay", async () => {
  using workspace = gitRepo({
    ...railsApp,
    'app/models/application_record.rb': 'class ApplicationRecord\nend\n',
    'app/models/order.rb': 'class Order < ApplicationRecord\nend\n',
    'app/controllers/application_controller.rb': 'class ApplicationController\nend\n',
    'app/controllers/admin/base_controller.rb':
      'class Admin::BaseController < ApplicationController\nend\n',
    'app/controllers/admin/users_controller.rb':
      'class Admin::UsersController < Admin::BaseController\nend\n',
    'app/jobs/application_job.rb': 'class ApplicationJob\nend\n',
    'app/jobs/export_job.rb': 'class ExportJob < ApplicationJob\nend\n',
    'app/mailers/application_mailer.rb': 'class ApplicationMailer\nend\n',
    'app/mailers/order_mailer.rb': 'class OrderMailer < ApplicationMailer\nend\n',
  });
  const { repo, root } = workspace;
  const shop = basename(repo);

  const range = await readRange({ repo, from: root, to: root });

  expect(range.after.edges).toEqual([
    { from: `${shop}/class/Admin::UsersController`, to: `${shop}/class/Admin::BaseController` },
  ]);
});

test('a changed Minitest file lists its tests under their class, added, edited or unchanged', async () => {
  const orderTest = (tests: string) =>
    `require "test_helper"\n\nclass OrderTest < ActiveSupport::TestCase\n  setup do\n    sign_in\n  end\n\n${tests}end\n`;
  using workspace = gitRepo({
    ...railsApp,
    'test/models/order_test.rb': orderTest(
      '  test "totals its lines" do\n    assert_equal 3, total\n  end\n\n  test "ships" do\n    assert shipped\n  end\n',
    ),
  });
  const { repo, root } = workspace;
  const to = commit(repo, {
    'test/models/order_test.rb': orderTest(
      '  test "totals its lines" do\n    assert_equal 4, total\n  end\n\n  test "ships" do\n    assert shipped\n  end\n\n  test "refunds a paid order" do\n    assert refunded\n  end\n',
    ),
  });

  const range = await readRange({ repo, from: root, to });

  expect(range.tests).toEqual([
    {
      path: 'test/models/order_test.rb',
      statements: [
        {
          kind: 'heading',
          name: 'OrderTest',
          children: [
            { kind: 'test', name: 'totals its lines', change: 'edited' },
            { kind: 'test', name: 'ships', change: 'unchanged' },
            { kind: 'test', name: 'refunds a paid order', change: 'added' },
          ],
        },
      ],
    },
  ]);
});

test('a changed RSpec file lists its tests under their describe and context, added, edited or unchanged', async () => {
  const orderSpec = (examples: string) =>
    `require "rails_helper"\n\nRSpec.describe Order do\n  let(:order) { create(:order) }\n\n  context "when paid" do\n${examples}  end\nend\n`;
  const shippable = (carrier: string) =>
    `    it_behaves_like "shippable" do\n      let(:carrier) { "${carrier}" }\n    end\n\n`;
  using workspace = gitRepo({
    ...railsApp,
    'spec/models/order_spec.rb': orderSpec(
      `${shippable('dhl')}    it "ships" do\n      expect(order).to be_shipped\n    end\n\n    it "totals its lines" do\n      expect(order.total).to eq(3)\n    end\n`,
    ),
  });
  const { repo, root } = workspace;
  const to = commit(repo, {
    'spec/models/order_spec.rb': orderSpec(
      `${shippable('ups')}    it "ships" do\n      expect(order).to be_shipped\n    end\n\n    it "totals its lines" do\n      expect(order.total).to eq(4)\n    end\n\n    it "refunds" do\n      expect(order).to be_refunded\n    end\n`,
    ),
  });

  const range = await readRange({ repo, from: root, to });

  expect(range.tests).toEqual([
    {
      path: 'spec/models/order_spec.rb',
      statements: [
        {
          kind: 'heading',
          name: 'Order',
          children: [
            {
              kind: 'heading',
              name: 'when paid',
              children: [
                { kind: 'test', name: '"shippable"', change: 'edited' },
                { kind: 'test', name: 'ships', change: 'unchanged' },
                { kind: 'test', name: 'totals its lines', change: 'edited' },
                { kind: 'test', name: 'refunds', change: 'added' },
              ],
            },
          ],
        },
      ],
    },
  ]);
});

test("a Minitest or RSpec file is read only under a test/ or spec/ folder of a Rails app's root", async () => {
  using workspace = gitRepo({
    'apps/shop/config/application.rb': railsApp['config/application.rb'],
  });
  const { repo, root } = workspace;
  const minitest = 'class SomeTest\n  test "works" do\n  end\nend\n';
  const rspec = 'describe Some do\n  it "works" do\n  end\nend\n';
  const to = commit(repo, {
    'apps/shop/test/models/order_test.rb': minitest,
    'apps/shop/lib/contest/money_test.rb': minitest,
    'tools/test/x_test.rb': minitest,
    'apps/shop/spec/models/order_spec.rb': rspec,
    'apps/shop/spec/support/order_examples.rb': rspec,
    'apps/shop/lib/inspec/money_spec.rb': rspec,
    'tools/spec/x_spec.rb': rspec,
  });

  const range = await readRange({ repo, from: root, to });

  expect(range.tests.map(({ path }) => path)).toEqual([
    'apps/shop/spec/models/order_spec.rb',
    'apps/shop/test/models/order_test.rb',
  ]);
});

const added = (name: string) => ({ kind: 'test', name, change: 'added' });

const testsAdded = async ({ path, file }: { path: string; file: string }) => {
  using workspace = gitRepo(railsApp);
  const { repo, root } = workspace;
  const to = commit(repo, { [path]: file });
  return (await readRange({ repo, from: root, to })).tests;
};

test.for([
  {
    reason: 'a class in a module, by its constant',
    file: 'module Admin\n  class UsersControllerTest\n    test "lists users" do\n    end\n  end\nend\n',
    statements: [
      { kind: 'heading', name: 'Admin::UsersControllerTest', children: [added('lists users')] },
    ],
  },
  {
    reason: 'a compact class line, by its constant',
    file: 'class Admin::UsersControllerTest\n  test "lists users" do\n  end\nend\n',
    statements: [
      { kind: 'heading', name: 'Admin::UsersControllerTest', children: [added('lists users')] },
    ],
  },
  {
    reason: 'a class in a class, inside its heading',
    file: 'class OrderTest\n  class RefundTest\n    test "refunds" do\n    end\n  end\n\n  test "ships" do\n  end\nend\n',
    statements: [
      {
        kind: 'heading',
        name: 'OrderTest',
        children: [
          { kind: 'heading', name: 'RefundTest', children: [added('refunds')] },
          added('ships'),
        ],
      },
    ],
  },
  {
    reason: 'two classes, one heading each',
    file: 'class OrderTest\n  test "ships" do\n  end\nend\n\nclass RefundTest\n  test "refunds" do\n  end\nend\n',
    statements: [
      { kind: 'heading', name: 'OrderTest', children: [added('ships')] },
      { kind: 'heading', name: 'RefundTest', children: [added('refunds')] },
    ],
  },
  {
    reason: 'no heading for a class holding no test',
    file: 'class FakeClient\n  def call = nil\nend\n\nclass OrderTest\n  test "ships" do\n  end\nend\n',
    statements: [{ kind: 'heading', name: 'OrderTest', children: [added('ships')] }],
  },
  {
    reason: 'a test in a loop, once, named as written',
    file: 'class OrderTest\n  %i[paid sent].each do |state|\n    test "#{state} works" do\n    end\n  end\nend\n',
    statements: [{ kind: 'heading', name: 'OrderTest', children: [added('#{state} works')] }],
  },
  {
    reason: 'no test for a test word called on a receiver',
    file: 'class ImportTest\n  setup do\n    @run = Importer.scenario(:nightly)\n    @suite = Suite.test("smoke")\n  end\n\n  test "imports" do\n  end\nend\n',
    statements: [{ kind: 'heading', name: 'ImportTest', children: [added('imports')] }],
  },
])('a Minitest file reads $reason', async ({ file, statements }) => {
  expect(await testsAdded({ path: 'test/models/order_test.rb', file })).toEqual([
    { path: 'test/models/order_test.rb', statements },
  ]);
});

const works = 'do\n  it "works" do\n  end\nend\n';

test.for([
  {
    reason: 'a group by its two descriptions, joined by a space',
    file: `RSpec.describe "create reseller", "as an admin" ${works}`,
    name: 'create reseller as an admin',
  },
  {
    reason: 'a class then a method, joined by nothing',
    file: `describe Order, "#total" ${works}`,
    name: 'Order#total',
  },
  {
    reason: 'a class then a class method, joined by nothing',
    file: `describe Order, ".build" ${works}`,
    name: 'Order.build',
  },
  {
    reason: 'a scoped class then a constant, joined by nothing',
    file: `describe Admin::Order, "::Line" ${works}`,
    name: 'Admin::Order::Line',
  },
  {
    reason: 'a class then words, joined by a space',
    file: `describe Order, "when paid. #2" ${works}`,
    name: 'Order when paid. #2',
  },
  {
    reason: 'a group with no description, as RSpec does, by nothing',
    file: `describe ${works}`,
    name: '',
  },
  {
    reason: 'a string then a method, joined by a space',
    file: `describe "Order", "#total" ${works}`,
    name: 'Order #total',
  },
  {
    reason: 'a group without its hash metadata',
    file: `RSpec.describe Order, type: :model ${works}`,
    name: 'Order',
  },
  {
    reason: 'a group without its symbol metadata',
    file: `describe "checkout", :integration ${works}`,
    name: 'checkout',
  },
])('an RSpec file names $reason', async ({ file, name }) => {
  expect(await testsAdded({ path: 'spec/models/order_spec.rb', file })).toEqual([
    {
      path: 'spec/models/order_spec.rb',
      statements: [{ kind: 'heading', name, children: [added('works')] }],
    },
  ]);
});

test.for([
  {
    reason: 'feature as a group holding scenario, specify and example tests',
    file: 'feature "checkout" do\n  scenario "pays" do\n  end\n\n  specify "ships" do\n  end\n\n  example "refunds" do\n  end\nend\n',
    statements: [
      {
        kind: 'heading',
        name: 'checkout',
        children: [added('pays'), added('ships'), added('refunds')],
      },
    ],
  },
  {
    reason: 'no heading for a group holding no test',
    file: 'describe Order do\n  context "when paid" do\n    let(:paid) { true }\n  end\n\n  it "works" do\n  end\nend\n',
    statements: [{ kind: 'heading', name: 'Order', children: [added('works')] }],
  },
  {
    reason: 'an example with no description, named by its block',
    file: 'describe Order do\n  it { is_expected.to be_a_success }\nend\n',
    statements: [
      { kind: 'heading', name: 'Order', children: [added('is_expected.to be_a_success')] },
    ],
  },
  {
    reason: 'each shared example inclusion as a test, named by its arguments',
    file: 'describe Order do\n  include_context "signed in"\n\n  it_behaves_like "requires authentication", :get, -> { orders_path }\n  it_behaves_like "requires authentication", :put, -> { order_path }\nend\n',
    statements: [
      {
        kind: 'heading',
        name: 'Order',
        children: [
          added('"requires authentication", :get, -> { orders_path }'),
          added('"requires authentication", :put, -> { order_path }'),
        ],
      },
    ],
  },
])('an RSpec file reads $reason', async ({ file, statements }) => {
  expect(await testsAdded({ path: 'spec/models/order_spec.rb', file })).toEqual([
    { path: 'spec/models/order_spec.rb', statements },
  ]);
});

test('a test_ method is a test named by the method, so renaming it removes one test and adds another', async () => {
  const orderTest = ({ method, shipped }: { method: string; shipped: string }) =>
    `class OrderTest\n  def self.test_data = []\n\n  def ${method}\n    assert_equal 3, tested_amount\n  end\n\n  def test_ships\n    assert ${shipped}\n  end\n\n  def tested_amount = 3\nend\n`;
  using workspace = gitRepo({
    ...railsApp,
    'test/models/order_test.rb': orderTest({ method: 'test_total', shipped: 'shipped' }),
  });
  const { repo, root } = workspace;
  const to = commit(repo, {
    'test/models/order_test.rb': orderTest({ method: 'test_sum', shipped: 'sent' }),
  });

  const range = await readRange({ repo, from: root, to });

  expect(range.tests).toEqual([
    {
      path: 'test/models/order_test.rb',
      statements: [
        {
          kind: 'heading',
          name: 'OrderTest',
          children: [
            { kind: 'test', name: 'test_total', change: 'removed' },
            { kind: 'test', name: 'test_sum', change: 'added' },
            { kind: 'test', name: 'test_ships', change: 'edited' },
          ],
        },
      ],
    },
  ]);
});
