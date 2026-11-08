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
