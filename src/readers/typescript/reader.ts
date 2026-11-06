import { existsSync, globSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { cruise } from 'dependency-cruiser';
import { folderOf, type StackSettings } from '../../core/config.ts';
import type { CandidateRoot, Reader } from '../../core/reader.ts';
import {
  packageNameIn,
  type RootOptions,
  resolutionIn,
  staysInCheckout,
  tsconfigIn,
} from './typescript-config.ts';
import { measureTypeScript } from './typescript-measure.ts';
import { symbolsOfTypeScript } from './typescript-symbols.ts';
import { readTypeScriptTests } from './typescript-tests.ts';
import { withTypeReexports } from './typescript-type-reexports.ts';
import { usesOfTypeScript } from './typescript-uses.ts';
import { webGraph } from './web-graph.ts';

const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const SCRIPT_FILE = /\.[cm]?[jt]sx?$/;

const SOURCES = '**/*.{ts,tsx,js,jsx,mjs,cjs}';

const isDirectory = (path: string): boolean => existsSync(path) && statSync(path).isDirectory();

const includedFolders = (directory: string, include: ReadonlyArray<string>) => [
  ...new Set(
    include
      .map(entry => folderOf(entry.replace(/[*?{[].*$/, '')))
      .filter(folder => folder !== '.' && isDirectory(join(directory, folder))),
  ),
];

const sourceRootOf = ({ checkout, root }: RootOptions): string => {
  const directory = join(checkout, root);
  const stays = staysInCheckout(root);
  const { compilerOptions, include = [] } = tsconfigIn(directory);
  const [folder, ...others] = includedFolders(directory, include).filter(stays);
  const rootDir = compilerOptions?.rootDir;
  if (rootDir !== undefined && stays(rootDir)) return folderOf(rootDir);
  return folder !== undefined && others.length === 0 ? folder : 'src';
};

const sourceRootIn = (options: RootOptions, { sourceRoot }: StackSettings): string =>
  sourceRoot === undefined ? sourceRootOf(options) : folderOf(sourceRoot);

const hasSources = (directory: string, sourceRoot: string): boolean =>
  globSync(SOURCES, { cwd: join(directory, sourceRoot) }).length > 0;

type HoldsOthersOptions = RootOptions & {
  readonly roots: ReadonlyArray<string>;
};

const holdsOthers = ({ checkout, root, roots }: HoldsOthersOptions): boolean => {
  const folder = join(root, sourceRootOf({ checkout, root }));
  return roots.some(other => other !== root && !relative(folder, other).startsWith('..'));
};

const rootsIn = (checkout: string): ReadonlyArray<CandidateRoot> => {
  const packages = globSync('**/package.json', {
    cwd: checkout,
    exclude: path => basename(path) === 'node_modules',
  })
    .map(dirname)
    .toSorted();
  const sourced = packages.filter(root =>
    hasSources(join(checkout, root), sourceRootOf({ checkout, root })),
  );
  return packages
    .filter(root => !holdsOthers({ checkout, root, roots: sourced }))
    .map(root => {
      const name = root === '.' ? packageNameIn(checkout) : undefined;
      return name === undefined ? { root } : { root, name };
    });
};

const packagesIn = (
  directory: string,
  stacks: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> =>
  new Map(
    [...stacks].flatMap(([root, stack]) => {
      const name = packageNameIn(join(directory, root));
      return name === undefined ? [] : [[name, stack] as const];
    }),
  );

type GraphOptions = {
  readonly directory: string;
  readonly root: string;
  readonly stack: string;
  readonly sourceRoot: string;
  readonly boxes: ReadonlyArray<string>;
  readonly packages: ReadonlyMap<string, string>;
  readonly stacks: ReadonlyMap<string, string>;
};

const leavingCheckoutFrom = (root: string): string =>
  `^(\\.\\./){${join(root, 'file').split('/').length}}`;

const graphAt = async ({
  directory,
  root,
  stack,
  sourceRoot,
  boxes,
  packages,
  stacks,
}: GraphOptions) => {
  const resolution = resolutionIn({ checkout: directory, root });
  const { output } = await cruise(
    [sourceRoot],
    {
      baseDir: join(directory, root),
      outputType: 'json',
      doNotFollow: { path: leavingCheckoutFrom(root) },
    },
    resolution,
  );
  return webGraph({
    stack,
    directory: root,
    sourceRoot,
    boxes,
    cruiseJson: withTypeReexports({
      cruiseJson: String(output),
      directory: join(directory, root),
      resolution,
    }),
    packages,
    stacks,
  });
};

export const typeScriptReader: Reader = {
  name: 'typescript',
  stackFields: ['boxes', 'sourceRoot'],
  roots: rootsIn,
  holds: ({ directory, root, settings }) =>
    hasSources(join(directory, root), sourceRootIn({ checkout: directory, root }, settings)),
  graph: ({ directory, root, stack, settings, stacks }) =>
    graphAt({
      directory,
      root,
      stack,
      sourceRoot: sourceRootIn({ checkout: directory, root }, settings),
      boxes: settings.boxes ?? [],
      packages: packagesIn(directory, stacks),
      stacks,
    }),
  isTestFile: path => TEST_FILE.test(path),
  readTests: readTypeScriptTests,
  measure: (text, path) => (TEST_FILE.test(path) ? undefined : measureTypeScript(text, path)),
  symbols: (text, path) =>
    SCRIPT_FILE.test(path) && !TEST_FILE.test(path) ? symbolsOfTypeScript(text, path) : undefined,
  uses: usesOfTypeScript,
};
