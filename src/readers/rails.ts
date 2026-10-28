import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { railsGraph } from '../rails-graph.ts';
import type { Reader } from '../reader.ts';
import { sourcesIn } from '../sources-in.ts';

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
          files: await sourcesIn(join(directory, root), RUBY_FILES),
        }),
    };
  },
  isTestFile: () => false,
  readTests: () => [],
};
