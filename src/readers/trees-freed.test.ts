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
    reading: 'Rails migrations',
    files: FILES,
    read: () => eachFile(text => railsMigrations.risks(text)),
  },
  {
    reading: 'Rails schema dumps',
    files: FILES,
    read: () => eachFile(text => railsSchema.tables(text)),
  },
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
