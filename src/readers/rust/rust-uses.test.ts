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
};

const WORKSPACE = { 'Cargo.toml': '[workspace]\nmembers = ["crates/*"]\nresolver = "2"\n' };

const crate = (name: string, dependencies = '') => ({
  [`crates/${name}/Cargo.toml`]: `[package]\nname = "${name}"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\n${dependencies}`,
});

const usesIn = async ({ files, target, names }: Scene) => {
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
    parse: [{ path: 'crates/shop/src/checkout.rs', line: 4, text: 'parse();' }],
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
    found: { line: 5, text: 'parse();' },
  },
  {
    reason: 'everything its module holds',
    file: 'crates/shop/src/checkout.rs',
    text: 'use crate::orders::*;\n\npub fn run() {\n    total();\n    parse();\n}\n',
    found: { line: 5, text: 'parse();' },
  },
  {
    reason: 'the function through `super`',
    file: 'crates/shop/src/checkout.rs',
    text: 'use super::orders::parse;\n\npub fn run() {\n    parse();\n}\n',
    found: { line: 4, text: 'parse();' },
  },
  {
    reason: 'the function through `super` twice',
    file: 'crates/shop/src/checkout/steps.rs',
    text: 'use super::super::orders::parse;\n\npub fn run() {\n    parse();\n}\n',
    found: { line: 4, text: 'parse();' },
  },
  {
    reason: 'the function through `self`',
    file: 'crates/shop/src/lib.rs',
    text: 'pub mod orders;\npub mod billing;\nuse self::orders::parse;\n\npub fn run() {\n    parse();\n}\n',
    found: { line: 6, text: 'parse();' },
  },
])('a module importing $reason', async ({ file, text, found }) => {
  const reading = await usesIn({
    files: { ...SHOP, [file]: text },
    target: 'crates/shop/src/orders.rs',
    names: ['parse'],
  });

  expect(reading?.uses).toEqual({
    parse: found === undefined ? [] : [{ path: file, ...found }],
  });
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
    [name]: [{ path: 'crates/shop/src/checkout.rs', ...found }],
  });
});

test('a function reaches a module of another crate importing it by that crate’s name', async () => {
  const reading = await usesIn({
    files: {
      ...crate('shop-core'),
      ...crate('shop', 'shop-core = { path = "../shop-core" }\n'),
      'crates/shop-core/src/lib.rs': 'pub mod orders;\n',
      'crates/shop-core/src/orders.rs': 'pub fn parse() {}\n',
      'crates/shop/src/lib.rs': 'pub mod checkout;\n',
      'crates/shop/src/checkout.rs':
        'use shop_core::orders::parse;\n\npub fn run() {\n    parse();\n}\n',
    },
    target: 'crates/shop-core/src/orders.rs',
    names: ['parse'],
  });

  expect(reading?.uses).toEqual({
    parse: [{ path: 'crates/shop/src/checkout.rs', line: 4, text: 'parse();' }],
  });
});
