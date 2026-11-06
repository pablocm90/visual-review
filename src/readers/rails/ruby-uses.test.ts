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

const ORDER = 'class Order\n  class Item\n  end\nend\n';

test.each([
  {
    how: 'an instance method goes by the class before its dot',
    asked: 'Order.total',
    called: 'Order.new.total',
  },
  {
    how: 'a class method drops its self',
    asked: 'Order.self.active',
    called: 'Order.active',
  },
  {
    how: 'a nested class keeps its ::',
    asked: 'Order::Item.price',
    called: 'Order::Item.new.price',
  },
])('$how, reaching the file naming the class, at the call', async ({ asked, called }) => {
  const member = called.slice(called.lastIndexOf('.') + 1);
  const reading = await usesIn({
    files: {
      'app/models/order.rb': ORDER,
      'app/services/caller.rb': `class Caller\n  def run\n    ${called}\n  end\nend\n`,
      'app/services/silent.rb': 'class Silent\n  def run\n    Order::Item\n    Order\n  end\nend\n',
      'app/services/stranger.rb': `class Stranger\n  def run(thing)\n    thing.${member}\n  end\nend\n`,
    },
    target: 'app/models/order.rb',
    names: [asked],
  });

  expect(reading?.uses).toEqual({
    [asked]: [{ path: 'app/services/caller.rb', line: 3, text: called }],
  });
});

test('a method is found on any receiver in that file, at the first call on its own line, not on self or on nothing', async () => {
  const reading = await usesIn({
    files: {
      'app/models/order.rb': ORDER,
      'app/services/caller.rb': [
        'class Caller',
        '  def run(found)',
        '    self.total',
        '    total(1)',
        '    Order.new',
        '    found',
        '      .itself',
        '      &.total',
        '    found.total',
        '  end',
        'end',
        '',
      ].join('\n'),
    },
    target: 'app/models/order.rb',
    names: ['Order.total'],
  });

  expect(reading?.uses).toEqual({
    'Order.total': [{ path: 'app/services/caller.rb', line: 8, text: '&.total' }],
  });
});

test('a method with no class around it reaches nothing, though an association reads like its name', async () => {
  const reading = await usesIn({
    files: {
      'app/models/order.rb': 'class Order\n  helper\nend\ndef helper\nend\n',
      'app/models/caller.rb': 'class Caller\n  has_one :order\n  has_one :helper\nend\n',
    },
    target: 'app/models/order.rb',
    names: ['helper', 'self.helper'],
  });

  expect(reading?.uses).toEqual({ helper: [], 'self.helper': [] });
});

test.each([
  { how: 'a block argument', written: 'lines.map(&:total)' },
  { how: 'a quoted block argument', written: 'lines.map(&:"total")' },
  { how: 'a block argument with no receiver', written: 'map(&:total)' },
  { how: 'send', written: 'found.send(:total)' },
  { how: 'send, with arguments', written: 'found.send(:total, 1)' },
  { how: 'send, by a string', written: 'found.send("total")' },
  { how: 'public_send', written: 'found.public_send(:total)' },
  { how: '__send__', written: 'found.__send__(:total)' },
  { how: 'try', written: 'found.try(:total)' },
  { how: 'delegate', written: 'delegate :total, to: :order' },
  { how: 'delegate, among others', written: 'delegate :price, :total, to: :order' },
])('$how names a method', async ({ written }) => {
  const reading = await usesIn({
    files: {
      'app/models/order.rb': ORDER,
      'app/services/caller.rb': `class Caller\n  Order\n  ${written}\nend\n`,
    },
    target: 'app/models/order.rb',
    names: ['Order.total'],
  });

  expect(reading?.uses).toEqual({
    'Order.total': [{ path: 'app/services/caller.rb', line: 3, text: written }],
  });
});

test.each([
  { how: 'a later argument of send', written: 'found.send(:price, :total)' },
  { how: 'an option of delegate', written: 'delegate :price, to: :total' },
  { how: 'a word of that name delegated', written: 'delegate total, to: :order' },
  { how: 'delegate on a receiver', written: 'found.delegate :total, to: :order' },
  { how: 'send on nothing', written: 'send(:total)' },
  { how: 'send on self', written: 'self.send(:total)' },
  { how: 'a block argument of that name', written: 'lines.map(&total)' },
  { how: 'a word of that name sent', written: 'found.send(total)' },
  { how: 'a string building that name', written: 'found.send("total#{suffix}")' },
  { how: 'another method taking that symbol', written: 'found.call(:total)' },
])('$how names no method', async ({ written }) => {
  const reading = await usesIn({
    files: {
      'app/models/order.rb': ORDER,
      'app/services/caller.rb': `class Caller\n  Order\n  ${written}\nend\n`,
    },
    target: 'app/models/order.rb',
    names: ['Order.total'],
  });

  expect(reading?.uses).toEqual({ 'Order.total': [] });
});

test('the first of any kind of use is the one shown, on the line of the name', async () => {
  const reading = await usesIn({
    files: {
      'app/models/order.rb': ORDER,
      'app/services/caller.rb': [
        'class Caller',
        '  Order',
        '  lines.map(',
        '    &:total',
        '  )',
        '  found.total',
        'end',
        '',
      ].join('\n'),
    },
    target: 'app/models/order.rb',
    names: ['Order.total'],
  });

  expect(reading?.uses).toEqual({
    'Order.total': [{ path: 'app/services/caller.rb', line: 4, text: '&:total' }],
  });
});

test('the constructor counts where the class is named, as nothing calls initialize by name', async () => {
  const reading = await usesIn({
    files: {
      'app/models/order.rb': ORDER,
      'app/services/caller.rb': 'class Caller\n  def run\n    Order.new(1)\n  end\nend\n',
    },
    target: 'app/models/order.rb',
    names: ['Order.initialize'],
  });

  expect(reading?.uses).toEqual({
    'Order.initialize': [{ path: 'app/services/caller.rb', line: 3, text: 'Order.new(1)' }],
  });
});
