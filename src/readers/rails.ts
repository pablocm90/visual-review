import { existsSync, globSync } from 'node:fs';
import { join } from 'node:path';
import { railsGraph } from '../rails-graph.ts';
import type { Reader } from '../reader.ts';

const RUBY_FILES = ['app/*/**/*.rb', 'lib/**/*.rb'];

export const railsReader: Reader = {
  name: 'rails',
  stackFields: [],
  open: ({ directory, repoName }) => {
    const stacks = new Map<string, string>(
      existsSync(join(directory, 'config/application.rb')) ? [['.', repoName] as const] : [],
    );
    return {
      stacks,
      graph: async root =>
        railsGraph({
          stack: stacks.get(root) ?? root,
          files: globSync(RUBY_FILES, { cwd: join(directory, root) }),
        }),
    };
  },
  isTestFile: () => false,
  readTests: () => [],
};
