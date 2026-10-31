import { existsSync, globSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { cruise } from 'dependency-cruiser';
import { parse } from 'jsonc-parser';
import { z } from 'zod';
import { folderOf, type StackSettings } from '../../core/config.ts';
import type { CandidateRoot, Reader } from '../../core/reader.ts';
import { measureTypeScript } from './typescript-measure.ts';
import { readTypeScriptTests } from './typescript-tests.ts';
import { webGraph } from './web-graph.ts';

const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

const SOURCES = '**/*.{ts,tsx,js,jsx,mjs,cjs}';

const TsconfigSchema = z.object({
  compilerOptions: z.object({ rootDir: z.string().optional() }).optional(),
  include: z.array(z.string()).optional(),
});

const tsconfigIn = (directory: string): z.infer<typeof TsconfigSchema> => {
  const tsconfig = join(directory, 'tsconfig.json');
  return existsSync(tsconfig)
    ? (TsconfigSchema.safeParse(parse(readFileSync(tsconfig, 'utf8'))).data ?? {})
    : {};
};

const isDirectory = (path: string): boolean => existsSync(path) && statSync(path).isDirectory();

const includedFolders = (directory: string, include: ReadonlyArray<string>) => [
  ...new Set(
    include
      .map(entry => folderOf(entry.replace(/[*?{[].*$/, '')))
      .filter(folder => folder !== '.' && isDirectory(join(directory, folder))),
  ),
];

const sourceRootOf = (directory: string): string => {
  const { compilerOptions, include = [] } = tsconfigIn(directory);
  const [folder, ...others] = includedFolders(directory, include);
  const rootDir = compilerOptions?.rootDir;
  if (rootDir !== undefined) return folderOf(rootDir);
  return folder !== undefined && others.length === 0 ? folder : 'src';
};

const PackageSchema = z.object({ name: z.string().optional() });

const packageNameIn = (directory: string): string | undefined => {
  const manifest = join(directory, 'package.json');
  return existsSync(manifest)
    ? PackageSchema.safeParse(parse(readFileSync(manifest, 'utf8'))).data?.name
    : undefined;
};

const sourceRootIn = (directory: string, { sourceRoot }: StackSettings): string =>
  sourceRoot === undefined ? sourceRootOf(directory) : folderOf(sourceRoot);

const hasSources = (directory: string, sourceRoot: string): boolean =>
  globSync(SOURCES, { cwd: join(directory, sourceRoot) }).length > 0;

type HoldsOthersOptions = {
  readonly checkout: string;
  readonly root: string;
  readonly roots: ReadonlyArray<string>;
};

const holdsOthers = ({ checkout, root, roots }: HoldsOthersOptions): boolean => {
  const folder = join(root, sourceRootOf(join(checkout, root)));
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
    hasSources(join(checkout, root), sourceRootOf(join(checkout, root))),
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
};

const graphAt = async ({ directory, root, stack, sourceRoot, boxes, packages }: GraphOptions) => {
  const { output } = await cruise([sourceRoot], {
    baseDir: join(directory, root),
    outputType: 'json',
  });
  return webGraph({
    stack,
    directory: root,
    sourceRoot,
    boxes,
    cruiseJson: String(output),
    packages,
  });
};

export const typeScriptReader: Reader = {
  name: 'typescript',
  stackFields: ['boxes', 'sourceRoot'],
  roots: rootsIn,
  holds: ({ directory, root, settings }) =>
    hasSources(join(directory, root), sourceRootIn(join(directory, root), settings)),
  graph: ({ directory, root, stack, settings, stacks }) =>
    graphAt({
      directory,
      root,
      stack,
      sourceRoot: sourceRootIn(join(directory, root), settings),
      boxes: settings.boxes ?? [],
      packages: packagesIn(directory, stacks),
    }),
  isTestFile: path => TEST_FILE.test(path),
  readTests: readTypeScriptTests,
  measure: measureTypeScript,
};
