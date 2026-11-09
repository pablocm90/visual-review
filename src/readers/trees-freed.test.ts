import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { writeFiles } from '../test-support/repos.ts';
import { railsReader } from './rails/reader.ts';

const FILES = 100;

const MOST_GROWTH = 32_000_000;

const rubyClass = (index: number): string =>
  [
    `class Model${index}`,
    ...Array.from(
      { length: 150 },
      (_, line) => `  def m${line}(a, b) = a.foo(b, Other::Thing.new(${line}), :sym, "str")`,
    ),
    'end',
    '',
  ].join('\n');

const eachFile = (read: (text: string, index: number) => unknown): ReadonlyArray<unknown> =>
  Array.from({ length: FILES }, (_, index) => read(rubyClass(index), index));

const heapGrowthOf = async (read: () => unknown): Promise<number> => {
  const before = process.memoryUsage().external;
  await read();
  return process.memoryUsage().external - before;
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
    read: () =>
      eachFile((text, index) => railsReader.measure?.(text, `app/models/model${index}.rb`)),
  },
  {
    reading: 'Ruby symbols',
    read: () =>
      eachFile((text, index) => railsReader.symbols?.(text, `app/models/model${index}.rb`)),
  },
])(
  'reading $reading frees each file’s tree, so the parser’s heap stays as it was',
  async ({ read }) => {
    expect(await heapGrowthOf(read)).toBeLessThan(MOST_GROWTH);
  },
);
