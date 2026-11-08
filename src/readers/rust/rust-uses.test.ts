import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { writeFiles } from '../../test-support/repos.ts';
import { rustReader } from './reader.ts';

type Scene = {
  readonly files: Readonly<Record<string, string>>;
  readonly target: string;
  readonly names: ReadonlyArray<string>;
  readonly goneAtHead?: ReadonlyArray<string>;
};

const WORKSPACE = { 'Cargo.toml': '[workspace]\nmembers = ["crates/*"]\nresolver = "2"\n' };

const crate = (name: string, dependencies = '') => ({
  [`crates/${name}/Cargo.toml`]: `[package]\nname = "${name}"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\n${dependencies}`,
});

const usesIn = async ({ files, target, names, goneAtHead = [] }: Scene) => {
  const checkout = mkdtempSync(join(tmpdir(), 'visual-review-rust-uses-'));
  try {
    writeFiles(checkout, { ...WORKSPACE, ...files });
    const stacks = new Map([['.', 'rust']]);
    const graph = await rustReader.graph({
      directory: checkout,
      root: '.',
      stack: 'rust',
      settings: {},
      stacks,
    });
    const node = graph.nodes.find(({ path }) => path === target);
    if (node === undefined) throw new Error(`no node at ${target}`);
    goneAtHead.forEach(path => {
      rmSync(join(checkout, path));
    });
    return await rustReader.uses?.({
      base: checkout,
      head: checkout,
      stacks,
      graph,
      graphAtHead: graph,
      node,
      names,
    });
  } finally {
    rmSync(checkout, { recursive: true, force: true });
  }
};

test('a function reaches the module importing it, where it is first called, and not one importing another', async () => {
  const reading = await usesIn({
    files: {
      ...crate('shop'),
      'crates/shop/src/lib.rs': 'pub mod orders;\npub mod checkout;\npub mod refund;\n',
      'crates/shop/src/orders.rs': 'pub fn parse() {}\npub fn total() {}\n',
      'crates/shop/src/checkout.rs':
        'use crate::orders::parse;\n\npub fn run() {\n    parse();\n    parse();\n}\n',
      'crates/shop/src/refund.rs': 'use crate::orders::total;\n\npub fn run() {\n    total();\n}\n',
    },
    target: 'crates/shop/src/orders.rs',
    names: ['parse'],
  });

  expect(reading?.uses).toEqual({
    parse: [{ path: 'crates/shop/src/checkout.rs', line: 4, text: 'parse();', test: false }],
  });
});

const SHOP = {
  ...crate('shop'),
  'crates/shop/src/lib.rs': 'pub mod orders;\npub mod billing;\npub mod checkout;\n',
  'crates/shop/src/orders.rs': 'pub fn parse() {}\npub fn total() {}\n',
  'crates/shop/src/billing.rs': 'pub fn parse() {}\n',
  'crates/shop/src/checkout.rs': 'pub mod steps;\n',
};

test.for([
  {
    reason: 'a function of that name in another module',
    file: 'crates/shop/src/checkout.rs',
    text: 'use crate::orders::total;\nuse crate::billing::parse;\n\npub fn run() {\n    parse();\n}\n',
    found: undefined,
  },
  {
    reason: 'the function under another name',
    file: 'crates/shop/src/checkout.rs',
    text: 'use crate::orders::parse as read;\n\npub fn run() {\n    parse();\n    read();\n}\n',
    found: { line: 5, text: 'read();' },
  },
  {
    reason: 'its module, then the function by path',
    file: 'crates/shop/src/checkout.rs',
    text: 'use crate::orders;\n\npub fn run() {\n    orders::total();\n    orders::parse();\n}\n',
    found: { line: 5, text: 'orders::parse();' },
  },
  {
    reason: 'the function, beside calling another of that name by path',
    file: 'crates/shop/src/checkout.rs',
    text: 'use crate::orders::parse;\n\npub fn run() {\n    crate::billing::parse();\n    parse();\n}\n',
    found: { line: 5, text: 'parse();', test: false },
  },
  {
    reason: 'everything its module holds',
    file: 'crates/shop/src/checkout.rs',
    text: 'use crate::orders::*;\n\npub fn run() {\n    total();\n    parse();\n}\n',
    found: { line: 5, text: 'parse();', test: false },
  },
  {
    reason: 'its module, beside a value’s field of the function’s name',
    file: 'crates/shop/src/checkout.rs',
    text: 'use crate::orders;\n\npub fn run() {\n    config.parse();\n    orders::parse();\n}\n',
    found: { line: 5, text: 'orders::parse();' },
  },
  {
    reason: 'another of its functions, then calling the function by its path from the crate',
    file: 'crates/shop/src/checkout.rs',
    text: 'use crate::orders::total;\n\npub fn run() {\n    total();\n    crate::orders::parse();\n}\n',
    found: { line: 5, text: 'crate::orders::parse();' },
  },
  {
    reason: 'another of its functions, then calling the function by its path from `super`',
    file: 'crates/shop/src/checkout.rs',
    text: 'use crate::orders::total;\n\npub fn run() {\n    total();\n    super::orders::parse();\n}\n',
    found: { line: 5, text: 'super::orders::parse();' },
  },
  {
    reason: 'another of its functions, then calling the function by its path from `self`',
    file: 'crates/shop/src/lib.rs',
    text: 'pub mod orders;\npub mod billing;\nuse orders::total;\n\npub fn run() {\n    total();\n    self::orders::parse();\n}\n',
    found: { line: 7, text: 'self::orders::parse();' },
  },
  {
    reason: 'the function through `super`',
    file: 'crates/shop/src/checkout.rs',
    text: 'use super::orders::parse;\n\npub fn run() {\n    parse();\n}\n',
    found: { line: 4, text: 'parse();', test: false },
  },
  {
    reason: 'the function through `super` twice',
    file: 'crates/shop/src/checkout/steps.rs',
    text: 'use super::super::orders::parse;\n\npub fn run() {\n    parse();\n}\n',
    found: { line: 4, text: 'parse();', test: false },
  },
  {
    reason: 'the function through `self`',
    file: 'crates/shop/src/lib.rs',
    text: 'pub mod orders;\npub mod billing;\nuse self::orders::parse;\n\npub fn run() {\n    parse();\n}\n',
    found: { line: 6, text: 'parse();', test: false },
  },
])('a module importing $reason', async ({ file, text, found }) => {
  const reading = await usesIn({
    files: { ...SHOP, [file]: text },
    target: 'crates/shop/src/orders.rs',
    names: ['parse'],
  });

  expect(reading?.uses).toEqual({
    parse: found === undefined ? [] : [{ path: file, ...found, test: false }],
  });
});

test('a module gone at the head reads as no use, beside one that still uses it', async () => {
  const reading = await usesIn({
    files: {
      ...SHOP,
      'crates/shop/src/lib.rs': 'pub mod orders;\npub mod checkout;\npub mod refund;\n',
      'crates/shop/src/checkout.rs':
        'use crate::orders::parse;\n\npub fn run() {\n    parse();\n}\n',
      'crates/shop/src/refund.rs': 'use crate::orders::parse;\n\npub fn run() {\n    parse();\n}\n',
    },
    target: 'crates/shop/src/orders.rs',
    names: ['parse'],
    goneAtHead: ['crates/shop/src/refund.rs'],
  });

  expect(reading?.uses).toEqual({
    parse: [{ path: 'crates/shop/src/checkout.rs', line: 4, text: 'parse();', test: false }],
  });
  expect(reading?.notRead).toEqual([]);
});

test.for([
  { reason: 'doesn’t parse', text: 'use crate::orders::parse;\n\npub fn run( {\n    parse();\n' },
  {
    reason: 'is too big',
    text: `use crate::orders::parse;\n\npub fn run() {\n    parse();\n}\n// ${'x'.repeat(1001)}\n`,
  },
])('a module that $reason is not read, beside one that uses it', async ({ text }) => {
  const reading = await usesIn({
    files: {
      ...SHOP,
      'crates/shop/src/lib.rs': 'pub mod orders;\npub mod checkout;\npub mod refund;\n',
      'crates/shop/src/checkout.rs':
        'use crate::orders::parse;\n\npub fn run() {\n    parse();\n}\n',
      'crates/shop/src/refund.rs': text,
    },
    target: 'crates/shop/src/orders.rs',
    names: ['parse'],
  });

  expect(reading?.uses).toEqual({
    parse: [{ path: 'crates/shop/src/checkout.rs', line: 4, text: 'parse();', test: false }],
  });
  expect(reading?.notRead).toEqual(['crates/shop/src/refund.rs']);
});

const ORDERS =
  'pub fn parse() {}\npub mod inner {\n    pub fn z() {}\n}\npub struct Order;\nimpl Order {\n    pub fn total(&self) {}\n}\n';

test.for([
  {
    reason: 'a function of an inline module',
    name: 'inner::z',
    text: 'use crate::orders::inner::z;\n\npub fn run() {\n    z();\n}\n',
    found: { line: 4, text: 'z();' },
  },
  {
    reason: 'a type, written as a parameter’s',
    name: 'Order',
    text: 'use crate::orders::Order;\n\npub fn run(order: Order) {}\n',
    found: { line: 3, text: 'pub fn run(order: Order) {}' },
  },
  {
    reason: 'a struct, built by name',
    name: 'Order',
    text: 'use crate::orders::Order;\n\npub fn run() {\n    let _ = Order {};\n}\n',
    found: { line: 4, text: 'let _ = Order {};' },
  },
  {
    reason: 'a type, written by its module’s path',
    name: 'Order',
    text: 'use crate::orders;\n\npub fn run(order: orders::Order) {}\n',
    found: { line: 3, text: 'pub fn run(order: orders::Order) {}' },
  },
  {
    reason: 'a method, called by its type’s path',
    name: 'Order.total',
    text: 'use crate::orders::Order;\n\npub fn run(order: Order) {\n    Order::total(&order);\n}\n',
    found: { line: 4, text: 'Order::total(&order);' },
  },
  {
    reason: 'a method, called on a value',
    name: 'Order.total',
    text: 'use crate::orders::Order;\n\npub fn run(order: Order) {\n    order.total();\n}\n',
    found: { line: 4, text: 'order.total();' },
  },
  {
    reason: 'a method, called on a value after another',
    name: 'Order.total',
    text: 'use crate::orders::Order;\n\npub fn run(order: Order) {\n    order.count();\n    order.total();\n}\n',
    found: { line: 5, text: 'order.total();' },
  },
  {
    reason: 'a method, called on a value after a struct literal setting a field of its name,',
    name: 'Order.total',
    text: 'use crate::orders::Order;\n\npub fn run(order: Order) {\n    let _ = Counts { total: 1 };\n    order.total();\n}\n',
    found: { line: 5, text: 'order.total();' },
  },
  {
    reason: 'a method, called on a value before by its type’s path',
    name: 'Order.total',
    text: 'use crate::orders::Order;\n\npub fn run(order: Order) {\n    order.total();\n    Order::total(&order);\n}\n',
    found: { line: 4, text: 'order.total();' },
  },
  {
    reason: 'a method, called on a value where its type is not imported,',
    name: 'Order.total',
    text: 'use crate::orders::parse;\n\npub fn run() {\n    parse();\n    order.total();\n}\n',
    found: undefined,
  },
])('$reason reaches a module importing it', async ({ name, text, found }) => {
  const reading = await usesIn({
    files: {
      ...SHOP,
      'crates/shop/src/orders.rs': ORDERS,
      'crates/shop/src/checkout.rs': text,
    },
    target: 'crates/shop/src/orders.rs',
    names: [name],
  });

  expect(reading?.uses).toEqual({
    [name]:
      found === undefined ? [] : [{ path: 'crates/shop/src/checkout.rs', ...found, test: false }],
  });
});

test.for([
  {
    how: 'importing it by that crate’s name',
    text: 'use shop_core::orders::parse;\n\npub fn run() {\n    parse();\n}\n',
    found: { line: 4, text: 'parse();' },
  },
  {
    how: 'importing it by that crate’s name from the extern prelude',
    text: 'use ::shop_core::orders::parse;\n\npub fn run() {\n    parse();\n}\n',
    found: { line: 4, text: 'parse();' },
  },
  {
    how: 'calling it by its path from that crate’s name',
    text: 'pub fn run() {\n    shop_core::orders::parse();\n}\n',
    found: { line: 2, text: 'shop_core::orders::parse();' },
  },
  {
    how: 'not by a path from its own crate',
    text: 'pub fn run() {\n    crate::orders::parse();\n}\n',
    found: undefined,
  },
])('a function reaches a module of another crate $how', async ({ text, found }) => {
  const reading = await usesIn({
    files: {
      ...crate('shop-core'),
      ...crate('shop', 'shop-core = { path = "../shop-core" }\n'),
      'crates/shop-core/src/lib.rs': 'pub mod orders;\n',
      'crates/shop-core/src/orders.rs': 'pub fn parse() {}\n',
      'crates/shop/src/lib.rs': 'pub mod checkout;\n',
      'crates/shop/src/checkout.rs': text,
    },
    target: 'crates/shop-core/src/orders.rs',
    names: ['parse'],
  });

  expect(reading?.uses).toEqual({
    parse:
      found === undefined ? [] : [{ path: 'crates/shop/src/checkout.rs', ...found, test: false }],
  });
});

test('a function used by a crate under a tests folder is used by test code', async () => {
  const reading = await usesIn({
    files: {
      'Cargo.toml': '[workspace]\nmembers = ["crates/*", "tests/e2e"]\nresolver = "2"\n',
      ...crate('shop-core'),
      'tests/e2e/Cargo.toml':
        '[package]\nname = "e2e"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\nshop-core = { path = "../../crates/shop-core" }\n',
      'crates/shop-core/src/lib.rs': 'pub mod orders;\n',
      'crates/shop-core/src/orders.rs': 'pub fn parse() {}\n',
      'tests/e2e/src/lib.rs': 'use shop_core::orders::parse;\n\npub fn run() {\n    parse();\n}\n',
    },
    target: 'crates/shop-core/src/orders.rs',
    names: ['parse'],
  });

  expect(reading?.uses).toEqual({
    parse: [{ path: 'tests/e2e/src/lib.rs', line: 4, text: 'parse();', test: true }],
  });
});

test.for([
  {
    reason: 'a method of a trait impl among others is',
    names: ['Order.total', 'Order as Display.fmt'],
    notFollowed: [
      'not followed: a module of its own crate with no `use` into its file, a name re-exported through `pub use`, and a path inside a macro',
      'not followed: a method called on a value in a file not importing its type',
      'not followed: a method of an `impl Trait for`',
    ],
  },
  {
    reason: 'a type’s own method is',
    names: ['Order.total'],
    notFollowed: [
      'not followed: a module of its own crate with no `use` into its file, a name re-exported through `pub use`, and a path inside a macro',
      'not followed: a method called on a value in a file not importing its type',
    ],
  },
  {
    reason: 'a type is',
    names: ['Basket'],
    notFollowed: [
      'not followed: a module of its own crate with no `use` into its file, a name re-exported through `pub use`, and a path inside a macro',
    ],
  },
])('$reason not followed, beside what no use is', async ({ names, notFollowed }) => {
  const reading = await usesIn({
    files: { ...SHOP, 'crates/shop/src/orders.rs': ORDERS },
    target: 'crates/shop/src/orders.rs',
    names,
  });

  expect(reading?.notFollowed).toEqual(notFollowed);
});
