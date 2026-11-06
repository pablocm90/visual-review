import { existsSync, globSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { cruise } from 'dependency-cruiser';
import { parse } from 'jsonc-parser';
import { z } from 'zod';
import { folderOf, type StackSettings } from '../../core/config.ts';
import type { CandidateRoot, Reader } from '../../core/reader.ts';
import { measureTypeScript } from './typescript-measure.ts';
import { symbolsOfTypeScript } from './typescript-symbols.ts';
import { readTypeScriptTests } from './typescript-tests.ts';
import { usesOfTypeScript } from './typescript-uses.ts';
import { webGraph } from './web-graph.ts';

const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const SCRIPT_FILE = /\.[cm]?[jt]sx?$/;

const SOURCES = '**/*.{ts,tsx,js,jsx,mjs,cjs}';

const TsconfigSchema = z.object({
  extends: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .catch(undefined),
  compilerOptions: z
    .object({
      rootDir: z.string().optional(),
      paths: z.record(z.string(), z.array(z.string())).optional().catch(undefined),
      baseUrl: z.string().optional().catch(undefined),
    })
    .optional(),
  include: z.array(z.string()).optional(),
});

const tsconfigAt = (tsconfig: string): z.infer<typeof TsconfigSchema> =>
  existsSync(tsconfig)
    ? (TsconfigSchema.safeParse(parse(readFileSync(tsconfig, 'utf8'))).data ?? {})
    : {};

const tsconfigIn = (directory: string): z.infer<typeof TsconfigSchema> =>
  tsconfigAt(join(directory, 'tsconfig.json'));

const isDirectory = (path: string): boolean => existsSync(path) && statSync(path).isDirectory();

const includedFolders = (directory: string, include: ReadonlyArray<string>) => [
  ...new Set(
    include
      .map(entry => folderOf(entry.replace(/[*?{[].*$/, '')))
      .filter(folder => folder !== '.' && isDirectory(join(directory, folder))),
  ),
];

type RootOptions = {
  readonly checkout: string;
  readonly root: string;
};

const staysInCheckout = (root: string) => (place: string) =>
  !isAbsolute(place) && !`${join(root, place)}/`.startsWith('../');

const sourceRootOf = ({ checkout, root }: RootOptions): string => {
  const directory = join(checkout, root);
  const stays = staysInCheckout(root);
  const { compilerOptions, include = [] } = tsconfigIn(directory);
  const [folder, ...others] = includedFolders(directory, include).filter(stays);
  const rootDir = compilerOptions?.rootDir;
  if (rootDir !== undefined && stays(rootDir)) return folderOf(rootDir);
  return folder !== undefined && others.length === 0 ? folder : 'src';
};

const PackageSchema = z.object({ name: z.string().optional() });

const packageNameIn = (directory: string): string | undefined => {
  const manifest = join(directory, 'package.json');
  return existsSync(manifest)
    ? PackageSchema.safeParse(parse(readFileSync(manifest, 'utf8'))).data?.name
    : undefined;
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
};

const MATCHES_RELATIVE_IMPORTS = /^[*.]/;

const prefixLength = (name: string): number => name.replace(/\*.*/, '').length;

type Aliases = {
  readonly baseUrl?: string;
  readonly paths?: {
    readonly places: Readonly<Record<string, ReadonlyArray<string>>>;
    readonly from: string;
  };
};

const withExtension = (config: string): string =>
  config.endsWith('.json') ? config : `${config}.json`;

const laterWins = (earlier: Aliases, later: Aliases): Aliases => ({ ...earlier, ...later });

const aliasesAt = (
  directory: string,
  config: string,
  known: Map<string, Aliases> = new Map(),
): Aliases => {
  const already = known.get(config);
  if (already !== undefined) return already;
  known.set(config, {});
  const { extends: extended = [], compilerOptions } = tsconfigAt(join(directory, config));
  const { baseUrl, paths } = compilerOptions ?? {};
  const from = dirname(config);
  const aliases = {
    ...[extended]
      .flat()
      .map(entry => aliasesAt(directory, withExtension(join(from, entry)), known))
      .reduce(laterWins, {}),
    ...(baseUrl === undefined || isAbsolute(baseUrl) ? {} : { baseUrl: join(from, baseUrl) }),
    ...(paths === undefined ? {} : { paths: { places: paths, from } }),
  };
  known.set(config, aliases);
  return aliases;
};

const resolutionIn = ({ checkout, root }: RootOptions) => {
  const directory = join(checkout, root);
  const stays = staysInCheckout(root);
  const { baseUrl, paths: pathsSaid } = aliasesAt(directory, 'tsconfig.json');
  const { places: paths = {}, from = '.' } = pathsSaid ?? {};
  const base = baseUrl !== undefined && stays(baseUrl) ? baseUrl : undefined;
  const placesOf = (places: ReadonlyArray<string>) =>
    places
      .filter(place => !isAbsolute(place))
      .map(place => join(base ?? from, place))
      .filter(stays);
  return {
    alias: Object.fromEntries(
      Object.entries(paths)
        .filter(([name]) => !MATCHES_RELATIVE_IMPORTS.test(name))
        .toSorted(([one], [other]) => prefixLength(other) - prefixLength(one))
        .map(([name, places]) => [name, placesOf(places).map(place => join(directory, place))]),
    ),
    modules: [
      ...placesOf(paths['*'] ?? [])
        .filter(place => basename(place) === '*')
        .map(place => join(directory, dirname(place))),
      ...(base === undefined ? [] : [join(directory, base)]),
      'node_modules',
      'node_modules/@types',
    ],
  };
};

const leavingCheckoutFrom = (root: string): string =>
  `^(\\.\\./){${join(root, 'file').split('/').length}}`;

const graphAt = async ({ directory, root, stack, sourceRoot, boxes, packages }: GraphOptions) => {
  const { output } = await cruise(
    [sourceRoot],
    {
      baseDir: join(directory, root),
      outputType: 'json',
      doNotFollow: { path: leavingCheckoutFrom(root) },
    },
    resolutionIn({ checkout: directory, root }),
  );
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
    hasSources(join(directory, root), sourceRootIn({ checkout: directory, root }, settings)),
  graph: ({ directory, root, stack, settings, stacks }) =>
    graphAt({
      directory,
      root,
      stack,
      sourceRoot: sourceRootIn({ checkout: directory, root }, settings),
      boxes: settings.boxes ?? [],
      packages: packagesIn(directory, stacks),
    }),
  isTestFile: path => TEST_FILE.test(path),
  readTests: readTypeScriptTests,
  measure: (text, path) => (TEST_FILE.test(path) ? undefined : measureTypeScript(text, path)),
  symbols: (text, path) =>
    SCRIPT_FILE.test(path) && !TEST_FILE.test(path) ? symbolsOfTypeScript(text, path) : undefined,
  uses: usesOfTypeScript,
};
