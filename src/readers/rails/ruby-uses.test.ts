import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { writeFiles } from '../../test-support/repos.ts';
import { railsReader } from './reader.ts';

type Scene = {
  readonly files: Readonly<Record<string, string>>;
  readonly target: string;
  readonly names: ReadonlyArray<string>;
};

const usesIn = async ({ files, target, names }: Scene) => {
  const checkout = mkdtempSync(join(tmpdir(), 'visual-review-ruby-uses-'));
  try {
    writeFiles(checkout, files);
    const graph = await railsReader.graph({
      directory: checkout,
      root: '.',
      stack: 'shop',
      settings: {},
      stacks: new Map([['.', 'shop']]),
    });
    const node = graph.nodes.find(({ path }) => path === target);
    if (node === undefined) throw new Error(`no node at ${target}`);
    return await railsReader.uses?.({
      base: checkout,
      head: checkout,
      stacks: new Map([['.', 'shop']]),
      graph,
      graphAtHead: graph,
      node,
      names,
    });
  } finally {
    rmSync(checkout, { recursive: true, force: true });
  }
};

test('a class reaches the file naming it, where it first does, and not a file naming another class', async () => {
  const reading = await usesIn({
    files: {
      'app/models/order.rb': 'class Order\nend\n',
      'app/models/refund.rb': 'class Refund\nend\n',
      'app/services/checkout.rb':
        'class Checkout\n  def run\n    Refund.new\n    Order.new\n    Order.new\n  end\nend\n',
      'app/services/payback.rb': 'class Payback\n  def run\n    Refund.new\n  end\nend\n',
    },
    target: 'app/models/order.rb',
    names: ['Order'],
  });

  expect(reading?.uses).toEqual({
    Order: [{ path: 'app/services/checkout.rb', line: 4, text: 'Order.new' }],
  });
});

test('a class nested in another file goes by its own name, and shadows the top-level one it hides', async () => {
  const reading = await usesIn({
    files: {
      'app/models/order.rb': 'class Order\n  class Item\n  end\nend\n',
      'app/models/item.rb': 'class Item\nend\n',
      'app/services/order/report.rb':
        'class Order\n  class Report\n    def run\n      Order.new\n      Item.new\n    end\n  end\nend\n',
      'app/services/export.rb': 'class Export\n  def run\n    Order::Item.new\n  end\nend\n',
    },
    target: 'app/models/order.rb',
    names: ['Order::Item', 'Order'],
  });

  expect(reading?.uses).toEqual({
    'Order::Item': [
      { path: 'app/services/export.rb', line: 3, text: 'Order::Item.new' },
      { path: 'app/services/order/report.rb', line: 5, text: 'Item.new' },
    ],
    Order: [{ path: 'app/services/order/report.rb', line: 4, text: 'Order.new' }],
  });
});

test('an association is a use, resolved from the class holding it', async () => {
  const reading = await usesIn({
    files: {
      'app/models/item.rb': 'class Item\nend\n',
      'app/models/billing/item.rb': 'module Billing\n  class Item\n  end\nend\n',
      'app/models/billing/invoice.rb':
        'module Billing\n  class Invoice\n    has_many :items\n  end\nend\n',
    },
    target: 'app/models/billing/item.rb',
    names: ['Billing::Item'],
  });

  expect(reading?.uses).toEqual({
    'Billing::Item': [{ path: 'app/models/billing/invoice.rb', line: 3, text: 'has_many :items' }],
  });
});
