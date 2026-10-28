import { existsSync, globSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { cruise } from 'dependency-cruiser';
import { parse } from 'jsonc-parser';
import { z } from 'zod';
import { addedStacks, folderOf, stackSettings } from '../config.ts';
import type { Checkout, Reader } from '../reader.ts';
import { stackIds } from '../stack-ids.ts';
import { readTypeScriptTests } from '../test-statements.ts';
import { webGraph } from '../web-graph.ts';

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

type RootOptions = {
  readonly checkout: Checkout;
  readonly root: string;
};

const stackAt = ({ checkout: { directory, repoName }, root }: RootOptions): string =>
  root === '.' ? (packageNameIn(directory) ?? repoName) : root;

type SourceRootOptions = RootOptions & { readonly stack: string };

const sourceRootIn = ({ checkout: { directory, config }, root, stack }: SourceRootOptions) => {
  const { sourceRoot } = stackSettings(config, stack);
  return sourceRoot === undefined ? sourceRootOf(join(directory, root)) : folderOf(sourceRoot);
};

const hasSources = ({ checkout, root }: RootOptions): boolean =>
  globSync(SOURCES, {
    cwd: join(
      checkout.directory,
      root,
      sourceRootIn({ checkout, root, stack: stackAt({ checkout, root }) }),
    ),
  }).length > 0;

type HoldsOptions = {
  readonly checkout: string;
  readonly root: string;
  readonly roots: ReadonlyArray<string>;
};

const holdsOthers = ({ checkout, root, roots }: HoldsOptions): boolean => {
  const folder = join(root, sourceRootOf(join(checkout, root)));
  return roots.some(other => other !== root && !relative(folder, other).startsWith('..'));
};

const rootsIn = (checkout: Checkout): ReadonlyArray<string> => {
  const roots = globSync('**/package.json', {
    cwd: checkout.directory,
    exclude: path => basename(path) === 'node_modules',
  })
    .map(dirname)
    .filter(root => hasSources({ checkout, root }))
    .toSorted();
  return roots.filter(root => !holdsOthers({ checkout: checkout.directory, root, roots }));
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
  open: checkout => {
    const { directory, config } = checkout;
    const detected = rootsIn(checkout);
    const detectedStacks = stackIds({
      roots: detected,
      taken: checkout.taken,
      idOf: root => stackAt({ checkout, root }),
    });
    const added = addedStacks({
      config,
      reader: 'typescript',
      detected: detectedStacks,
      taken: checkout.taken,
    }).filter(({ root, stack }) =>
      isDirectory(join(directory, root, sourceRootIn({ checkout, root, stack }))),
    );
    const stacks = new Map([
      ...detectedStacks,
      ...added.map(({ root, stack }) => [root, stack] as const),
    ]);
    const packages = packagesIn(directory, stacks);
    return {
      stacks,
      graph: root => {
        const stack = stacks.get(root) ?? root;
        const { boxes = [] } = stackSettings(config, stack);
        return graphAt({
          directory,
          root,
          stack,
          sourceRoot: sourceRootIn({ checkout, root, stack }),
          boxes,
          packages,
        });
      },
    };
  },
  isTestFile: path => TEST_FILE.test(path),
  readTests: readTypeScriptTests,
};
