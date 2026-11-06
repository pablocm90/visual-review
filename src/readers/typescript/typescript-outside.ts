import { globSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { isUnder } from './web-graph.ts';

const SCRIPTS = '**/*.{ts,tsx,js,jsx,mjs,cjs}';

const isDependencies = (path: string): boolean => basename(path) === 'node_modules';

type ScriptsOptions = {
  readonly head: string;
  readonly root: string;
  readonly roots: ReadonlyArray<string>;
};

export const scriptsOfStack = ({ head, root, roots }: ScriptsOptions): ReadonlyArray<string> => {
  const cwd = join(head, root);
  const others = [
    ...globSync('**/package.json', { cwd, exclude: isDependencies })
      .map(dirname)
      .filter(folder => folder !== '.'),
    ...roots
      .filter(other => other !== root && isUnder(root, other))
      .map(other => relative(root, other)),
  ];
  return globSync(SCRIPTS, { cwd, exclude: isDependencies })
    .filter(file => !others.some(folder => isUnder(folder, file)))
    .map(file => join(root, file));
};
