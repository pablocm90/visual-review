import { existsSync, globSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { addedStacks } from '../config.ts';
import { railsGraph } from '../rails-graph.ts';
import type { Reader } from '../reader.ts';
import { sourcesIn } from '../sources-in.ts';
import { stackIds } from '../stack-ids.ts';

const APPLICATION = 'config/application.rb';

const NOT_SEARCHED = new Set(['vendor', 'node_modules', 'test', 'spec']);

const RUBY_FILES = ['app/*/**/*.rb', 'lib/**/*.rb'];

const isApp = (directory: string): boolean => existsSync(join(directory, APPLICATION));

const rootsIn = (directory: string): ReadonlyArray<string> =>
  globSync(`**/${APPLICATION}`, {
    cwd: directory,
    exclude: path => NOT_SEARCHED.has(basename(path)),
  })
    .map(file => dirname(dirname(file)))
    .toSorted();

export const railsReader: Reader = {
  name: 'rails',
  stackFields: [],
  open: ({ directory, repoName, config, taken }) => {
    const detected = stackIds({
      roots: rootsIn(directory),
      taken,
      idOf: root => (root === '.' ? repoName : root),
    });
    const stacks = new Map([
      ...detected,
      ...addedStacks({ config, reader: 'rails', detected, taken })
        .filter(({ root }) => isApp(join(directory, root)))
        .map(({ root, stack }) => [root, stack] as const),
    ]);
    return {
      stacks,
      graph: async root =>
        railsGraph({
          stack: stacks.get(root) ?? root,
          root,
          files: await sourcesIn(join(directory, root), RUBY_FILES),
        }),
    };
  },
  isTestFile: () => false,
  readTests: () => [],
};
