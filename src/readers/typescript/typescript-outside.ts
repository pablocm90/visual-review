import { globSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import type { Graph, GraphNode } from '../../core/graph.ts';
import { isUnder } from './web-graph.ts';

const MOST_OUTSIDE_FILES = 5000;

const SCRIPTS = '**/*.{ts,tsx,js,jsx,mjs,cjs}';

const isDependencies = (path: string): boolean => basename(path) === 'node_modules';

type ScriptsOptions = {
  readonly head: string;
  readonly root: string;
  readonly roots: ReadonlyArray<string>;
};

const scriptsOfStack = ({ head, root, roots }: ScriptsOptions): ReadonlyArray<string> => {
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

type OutsideOptions = {
  readonly head: string;
  readonly stacks: ReadonlyMap<string, string>;
  readonly graph: Graph;
};

type Outside = {
  readonly nodes: ReadonlyArray<GraphNode>;
  readonly notFollowed: ReadonlyArray<string>;
};

export const filesOutside = ({ head, stacks, graph }: OutsideOptions): Outside => {
  const drawn = new Set(graph.nodes.map(({ path }) => path));
  const read = [...stacks].map(([root, stack]) => ({
    stack,
    paths: scriptsOfStack({ head, root, roots: [...stacks.keys()] }).filter(
      path => !drawn.has(path),
    ),
  }));
  return {
    nodes: read
      .filter(({ paths }) => paths.length <= MOST_OUTSIDE_FILES)
      .flatMap(({ stack, paths }) =>
        paths.map(path => ({
          id: `${stack}/outside/${path}`,
          kind: 'file' as const,
          label: path,
          parent: stack,
          path,
        })),
      ),
    notFollowed: read
      .filter(({ paths }) => paths.length > MOST_OUTSIDE_FILES)
      .map(
        ({ stack }) =>
          `not followed: ${stack} has over ${MOST_OUTSIDE_FILES} files outside its source root`,
      ),
  };
};
