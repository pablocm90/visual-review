import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { Parser, Tree } from 'web-tree-sitter';
import { writeFiles } from '../test-support/repos.ts';
import { railsMigrations } from './rails/migration-risks.ts';
import { railsReader } from './rails/reader.ts';
import { railsRoutes } from './rails/route-reader.ts';
import { railsSchema } from './rails/schema-tables.ts';
import { crateModules } from './rust/crate-modules.ts';
import { rustReader } from './rust/reader.ts';

const FILES = 2;

const rubyClass = (index: number): string =>
  `class Model${index}\n  def m(a) = a.foo(Other::Thing.new(${index}))\nend\n`;

const eachFile = (read: (text: string, index: number) => unknown): ReadonlyArray<unknown> =>
  Array.from({ length: FILES }, (_, index) => read(rubyClass(index), index));

const routeFiles = (): ReadonlyMap<string, string> =>
  new Map([
    [
      'config/routes.rb',
      [
        'Rails.application.routes.draw do',
        ...Array.from({ length: FILES }, (_, index) => `  draw :part${index}`),
        'end',
      ].join('\n'),
    ],
    ...Array.from({ length: FILES }, (_, index): [string, string] => [
      `config/routes/part${index}.rb`,
      `get "/part${index}", to: "pages#show"`,
    ]),
  ]);

const rustModule = (index: number): string =>
  `mod m${index + 1};\nuse crate::m${index}::Thing;\npub fn f${index}() {}\n`;

const eachRustFile = (read: (text: string, index: number) => unknown): ReadonlyArray<unknown> =>
  Array.from({ length: FILES }, (_, index) => read(rustModule(index), index));

const crateSources = (): Readonly<Record<string, string>> =>
  Object.fromEntries(
    Array.from({ length: FILES }, (_, index) => [
      index === 0 ? 'src/lib.rs' : `src/m${index}.rs`,
      rustModule(index),
    ]),
  );

const treesOf = async (read: () => unknown) => {
  const parsed = vi.spyOn(Parser.prototype, 'parse');
  const deleted = vi.spyOn(Tree.prototype, 'delete');
  try {
    await read();
    return {
      parsed: parsed.mock.results.filter(({ value }) => value instanceof Tree).length,
      deleted: deleted.mock.calls.length,
    };
  } finally {
    parsed.mockRestore();
    deleted.mockRestore();
  }
};

const inCheckout = async <T>(
  files: Readonly<Record<string, string>>,
  read: (checkout: string) => Promise<T>,
): Promise<T> => {
  const checkout = mkdtempSync(join(tmpdir(), 'visual-review-trees-'));
  try {
    writeFiles(checkout, files);
    return await read(checkout);
  } finally {
    rmSync(checkout, { recursive: true, force: true });
  }
};

const railsApp = (): Readonly<Record<string, string>> =>
  Object.fromEntries([
    ['config/application.rb', 'module Shop\n  class Application\n  end\nend\n'],
    ...Array.from({ length: FILES }, (_, index) => [
      `app/models/model${index}.rb`,
      rubyClass(index),
    ]),
  ]);

const IMPORTERS = Array.from({ length: FILES }, (_, index) => index);

const usesInRails = () =>
  inCheckout(
    {
      'config/application.rb': 'module Shop\n  class Application\n  end\nend\n',
      'app/models/order.rb': 'class Order\nend\n',
      ...Object.fromEntries(
        IMPORTERS.map(index => [
          `app/models/user${index}.rb`,
          `class User${index}\n  def m = Order.new\nend\n`,
        ]),
      ),
    },
    async directory => {
      const stacks = new Map([['.', 'shop']]);
      const graph = await railsReader.graph({
        directory,
        root: '.',
        stack: 'shop',
        settings: {},
        stacks,
      });
      const node = graph.nodes.find(({ path }) => path === 'app/models/order.rb');
      if (node === undefined) throw new Error('no Order');
      return railsReader.uses?.({
        base: directory,
        head: directory,
        stacks,
        graph,
        graphAtHead: graph,
        node,
        names: ['Order'],
      });
    },
  );

const usesInRust = () => {
  const sources = {
    'src/lib.rs': ['pub mod orders;', ...IMPORTERS.map(index => `pub mod user${index};`)].join(
      '\n',
    ),
    'src/orders.rs': 'pub fn total() {}\n',
    ...Object.fromEntries(
      IMPORTERS.map(index => [
        `src/user${index}.rs`,
        'use crate::orders::total;\npub fn f() {\n    total();\n}\n',
      ]),
    ),
  };
  return inCheckout(sources, async directory => {
    const graph = crateModules({
      stack: 'rust',
      root: '.',
      crate: 'app',
      roots: ['src/lib.rs'],
      sources,
    });
    const node = graph.nodes.find(({ path }) => path === 'src/orders.rs');
    if (node === undefined) throw new Error('no orders');
    const stacks = new Map([['.', 'rust']]);
    return rustReader.uses?.({
      base: directory,
      head: directory,
      stacks,
      graph,
      graphAtHead: graph,
      node,
      names: ['total'],
    });
  });
};

test.for([
  {
    reading: 'a Rails graph',
    files: FILES,
    read: () =>
      inCheckout(railsApp(), directory =>
        railsReader.graph({
          directory,
          root: '.',
          stack: 'shop',
          settings: {},
          stacks: new Map([['.', 'shop']]),
        }),
      ),
  },
  {
    reading: 'Ruby measures',
    files: FILES,
    read: () =>
      eachFile((text, index) => railsReader.measure?.(text, `app/models/model${index}.rb`)),
  },
  {
    reading: 'Ruby symbols',
    files: FILES,
    read: () =>
      eachFile((text, index) => railsReader.symbols?.(text, `app/models/model${index}.rb`)),
  },
  {
    reading: 'Ruby tests',
    files: FILES,
    read: () => eachFile(text => railsReader.readTests(text)),
  },
  {
    reading: 'Rails migrations',
    files: FILES,
    read: () => eachFile(text => railsMigrations.risks(text)),
  },
  {
    reading: 'Rails schema dumps',
    files: FILES,
    read: () => eachFile(text => railsSchema.tables(text)),
  },
  {
    reading: 'a crate’s modules',
    files: FILES,
    read: () =>
      crateModules({
        stack: 'rust',
        root: '.',
        crate: 'app',
        roots: ['src/lib.rs'],
        sources: crateSources(),
      }),
  },
  {
    reading: 'Rust measures',
    files: FILES,
    read: () => eachRustFile((text, index) => rustReader.measure?.(text, `src/m${index}.rs`)),
  },
  {
    reading: 'Rust symbols',
    files: FILES,
    read: () => eachRustFile((text, index) => rustReader.symbols?.(text, `src/m${index}.rs`)),
  },
  {
    reading: 'Rust tests',
    files: FILES,
    read: () => eachRustFile(text => rustReader.readTests(text)),
  },
  { reading: 'where a Rails class is used', files: 2 * FILES + 1, read: usesInRails },
  { reading: 'where a Rust function is used', files: 2 * FILES + 2, read: usesInRust },
  { reading: 'Rails routes', files: FILES + 1, read: () => railsRoutes.routes(routeFiles()) },
  {
    reading: 'a schema dump that doesn’t parse',
    files: 1,
    read: () => expect(() => railsSchema.tables('create_table "a" do')).toThrow(),
  },
])(
  'reading $reading deletes every tree it parses, so a big repo can’t fill the parser’s heap',
  async ({ files, read }) => {
    expect(await treesOf(read)).toEqual({ parsed: files, deleted: files });
  },
);
