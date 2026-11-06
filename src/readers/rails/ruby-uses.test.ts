import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { writeFiles } from '../../test-support/repos.ts';
import { railsReader } from './reader.ts';
import { METHODS_NOT_FOLLOWED, NOT_DRAWN } from './ruby-uses.ts';

type Scene = {
  readonly files: Readonly<Record<string, string>>;
  readonly target: string;
  readonly names: ReadonlyArray<string>;
  readonly changeHead?: (checkout: string) => void;
};

const usesIn = async ({ files, target, names, changeHead }: Scene) => {
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
    changeHead?.(checkout);
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
  { how: 'send of its setter', written: 'found.send(:total=, 1)' },
  { how: 'public_send of its setter, by a string', written: 'found.public_send("total=", 1)' },
  { how: 'delegate of its setter', written: 'delegate :total=, to: :order' },
  { how: 'delegate', written: 'delegate :total, to: :order' },
  { how: 'delegate, among others', written: 'delegate :price, :total, to: :order' },
  { how: 'def_delegators', written: 'def_delegators :@order, :price, :total' },
  { how: 'def_delegator', written: 'def_delegator :@order, :total' },
  { how: 'def_delegator, aliased', written: 'def_delegator :@order, :total, :sum' },
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
  { how: 'delegate on a receiver', written: 'found.delegate :total, to: :order' },
  { how: 'send on nothing', written: 'send(:total)' },
  { how: 'send on self', written: 'self.send(:total)' },
  { how: 'a block argument of that name', written: 'lines.map(&total)' },
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

test.each([
  { asked: 'send', written: 'found.send' },
  { asked: 'send', written: 'found.send("+33", "hi")' },
  { asked: 'public_send', written: 'found.public_send(:deliver)' },
  { asked: 'try', written: 'found.try' },
  { asked: '==', written: 'found.send(:==, 1)' },
  { asked: '<=', written: 'found.send(:<=, 1)' },
])('a method itself named $asked is used by $written', async ({ asked, written }) => {
  const name = `Order.${asked}`;
  const reading = await usesIn({
    files: {
      'app/models/order.rb': ORDER,
      'app/services/caller.rb': `class Caller\n  Order\n  ${written}\nend\n`,
    },
    target: 'app/models/order.rb',
    names: [name],
  });

  expect(reading?.uses).toEqual({
    [name]: [{ path: 'app/services/caller.rb', line: 3, text: written }],
  });
});

test('in a chain the first call to it is the one shown, though the last holds the rest', async () => {
  const reading = await usesIn({
    files: {
      'app/models/order.rb': ORDER,
      'app/services/caller.rb': [
        'class Caller',
        '  Order',
        '  found.total',
        '    .itself',
        '    .total',
        'end',
        '',
      ].join('\n'),
    },
    target: 'app/models/order.rb',
    names: ['Order.total'],
  });

  expect(reading?.uses).toEqual({
    'Order.total': [{ path: 'app/services/caller.rb', line: 3, text: 'found.total' }],
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

test.each([
  { how: 'a word', written: 'found.send(name)' },
  { how: 'a built string', written: 'found.public_send("to_#{kind}")' },
  { how: 'a built symbol', written: 'found.__send__(:"to_#{kind}")' },
  { how: 'a splat', written: 'found.try(*asked)' },
  { how: 'a %q string', written: 'found.send(%q(total))' },
  { how: 'a % string', written: 'found.send(%(total))' },
  { how: 'a %s symbol', written: 'found.send(%s(total))' },
  { how: 'an escape', written: 'found.send("to\\x74al")' },
])('a send of $how may use the method, in a file naming its class', async ({ written }) => {
  const reading = await usesIn({
    files: {
      'app/models/order.rb': ORDER,
      'app/services/caller.rb': `class Caller\n  Order\n  ${written}\nend\n`,
      'app/services/other.rb': `class Other\n  ${written}\nend\n`,
    },
    target: 'app/models/order.rb',
    names: ['Order.total'],
  });

  expect(reading?.uses).toEqual({
    'Order.total': [{ path: 'app/services/caller.rb', line: 3, text: written, unfollowed: true }],
  });
});

test.each([
  { how: 'a word', written: 'delegate total, to: :order' },
  { how: 'a splat', written: 'delegate(*NAMES, to: :order)' },
  { how: 'a splat of a list', written: 'delegate(*%i[total], to: :order)' },
  { how: 'a splat among names', written: 'delegate :price, *NAMES, to: :order' },
  { how: 'a word in a loop', written: '%i[total].each { |name| delegate name, to: :order }' },
  { how: 'a splat to def_delegators', written: 'def_delegators :@order, *NAMES' },
])('a delegate of $how may use the method', async ({ written }) => {
  const reading = await usesIn({
    files: {
      'app/models/order.rb': ORDER,
      'app/services/caller.rb': `class Caller\n  Order\n  ${written}\nend\n`,
    },
    target: 'app/models/order.rb',
    names: ['Order.total'],
  });

  expect(reading?.uses).toEqual({
    'Order.total': [{ path: 'app/services/caller.rb', line: 3, text: written, unfollowed: true }],
  });
});

test.each([
  { how: 'names it can read', written: 'delegate :price, to: :order' },
  { how: 'only options', written: 'delegate to: :order' },
  { how: 'a receiver', written: 'found.delegate(*NAMES, to: :order)' },
])('a delegate of $how is no use of another method', async ({ written }) => {
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

test('a use found in the file wins over a send that may be one, and a send of another name is none', async () => {
  const reading = await usesIn({
    files: {
      'app/models/order.rb': ORDER,
      'app/services/caller.rb': 'class Caller\n  Order\n  found.send(name)\n  found.total\nend\n',
      'app/services/named.rb':
        'class Named\n  Order\n  found.send(:price)\n  send(name)\n  self.send(name)\n  found.send\n  found.try(&:price)\n  found.call(name)\nend\n',
    },
    target: 'app/models/order.rb',
    names: ['Order.total', 'Order'],
  });

  expect(reading?.uses).toEqual({
    'Order.total': [{ path: 'app/services/caller.rb', line: 4, text: 'found.total' }],
    Order: [
      { path: 'app/services/caller.rb', line: 2, text: 'Order' },
      { path: 'app/services/named.rb', line: 2, text: 'Order' },
    ],
  });
});

const CALLER = 'app/services/caller.rb';

const readingWhenCaller = (change: (file: string) => void) =>
  usesIn({
    files: {
      'app/models/order.rb': ORDER,
      [CALLER]: 'class Caller\n  Order\nend\n',
      'app/services/other.rb': 'class Other\n  Order\nend\n',
    },
    target: 'app/models/order.rb',
    names: ['Order', 'Order.total'],
    changeHead: checkout => change(join(checkout, CALLER)),
  });

const OTHER_ROW = { path: 'app/services/other.rb', line: 2, text: 'Order' };

test.each([
  {
    how: 'does not parse',
    change: (file: string) => writeFileSync(file, 'class Caller\n  Order\n  def (\n'),
  },
  {
    how: 'has a line too long to read',
    change: (file: string) =>
      writeFileSync(file, `class Caller\n  Order\n  # ${'x'.repeat(1000)}\nend\n`),
  },
  {
    how: 'cannot be opened',
    change: (file: string) => {
      rmSync(file);
      symlinkSync(file, file);
    },
  },
])(
  'a file naming the class that $how is named once as not read, the others still read',
  async ({ change }) => {
    const reading = await readingWhenCaller(change);

    expect(reading).toMatchObject({
      uses: { Order: [OTHER_ROW], 'Order.total': [] },
      notRead: [CALLER],
    });
  },
);

test.each([
  { how: 'is gone', change: (file: string) => rmSync(file) },
  {
    how: 'is a folder',
    change: (file: string) => {
      rmSync(file);
      mkdirSync(file);
    },
  },
])('a file that $how at the head holds no use, and nothing to say', async ({ change }) => {
  const reading = await readingWhenCaller(change);

  expect(reading).toMatchObject({ uses: { Order: [OTHER_ROW] }, notRead: [] });
});

test.each([
  { asked: 'a class', names: ['Order'], notFollowed: [NOT_DRAWN] },
  { asked: 'a method', names: ['Order.total'], notFollowed: [NOT_DRAWN, METHODS_NOT_FOLLOWED] },
  {
    asked: 'a class and its method',
    names: ['Order', 'Order.total'],
    notFollowed: [NOT_DRAWN, METHODS_NOT_FOLLOWED],
  },
  {
    asked: 'a method with no class',
    names: ['helper'],
    notFollowed: [NOT_DRAWN, METHODS_NOT_FOLLOWED],
  },
])('asked about $asked, it says what it cannot see', async ({ names, notFollowed }) => {
  const reading = await usesIn({
    files: { 'app/models/order.rb': ORDER },
    target: 'app/models/order.rb',
    names,
  });

  expect(reading?.notFollowed).toEqual(notFollowed);
});
