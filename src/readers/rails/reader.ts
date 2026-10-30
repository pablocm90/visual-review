import { existsSync, globSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { Reader } from '../../core/reader.ts';
import { sourcesIn } from '../sources-in.ts';
import { readMinitestTests } from './minitest-tests.ts';
import { railsGraph } from './rails-graph.ts';

const APPLICATION = 'config/application.rb';

const NOT_SEARCHED = new Set(['vendor', 'node_modules', 'test', 'spec']);

const RUBY_FILES = ['app/*/**/*.rb', 'lib/**/*.rb'];

const TEST_FILE = /(^|\/)(test\/.+_test|spec\/.+_spec)\.rb$/;

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
  roots: directory => rootsIn(directory).map(root => ({ root })),
  holds: ({ directory, root }) => existsSync(join(directory, root, APPLICATION)),
  graph: async ({ directory, root, stack }) =>
    railsGraph({ stack, root, files: await sourcesIn(join(directory, root), RUBY_FILES) }),
  isTestFile: path => TEST_FILE.test(path),
  readTests: readMinitestTests,
};
