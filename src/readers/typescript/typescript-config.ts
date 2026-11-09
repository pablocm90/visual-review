import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { parse } from 'jsonc-parser';
import { z } from 'zod';

const TsconfigSchema = z.object({
  extends: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .catch(undefined),
  references: z
    .array(z.object({ path: z.string() }))
    .optional()
    .catch(undefined),
  compilerOptions: z
    .object({
      rootDir: z.string().optional(),
      paths: z.record(z.string(), z.array(z.string())).optional().catch(undefined),
      baseUrl: z.string().optional().catch(undefined),
    })
    .optional(),
  files: z.array(z.string()).optional().catch(undefined),
  include: z.array(z.string()).optional(),
});

const isFile = (path: string): boolean => existsSync(path) && statSync(path).isFile();

const tsconfigAt = (tsconfig: string): z.infer<typeof TsconfigSchema> =>
  isFile(tsconfig)
    ? (TsconfigSchema.safeParse(parse(readFileSync(tsconfig, 'utf8'))).data ?? {})
    : {};

const rootConfigIn = (directory: string): string =>
  isFile(join(directory, 'tsconfig.json')) ? 'tsconfig.json' : 'jsconfig.json';

export const tsconfigIn = (directory: string): z.infer<typeof TsconfigSchema> =>
  tsconfigAt(join(directory, rootConfigIn(directory)));

export type RootOptions = {
  readonly checkout: string;
  readonly root: string;
};

export const staysInCheckout = (root: string) => (place: string) =>
  !isAbsolute(place) && !`${join(root, place)}/`.startsWith('../');

const MATCHES_FILE_PATHS = /^[*./]/;

const prefixLength = (name: string): number =>
  name.includes('*') ? name.indexOf('*') : name.length + 1;

type Paths = Readonly<Record<string, ReadonlyArray<string>>>;

type Aliases = {
  readonly baseUrl?: string;
  readonly paths?: {
    readonly places: Paths;
    readonly from: string;
  };
};

const withExtension = (config: string): string =>
  config.endsWith('.json') ? config : `${config}.json`;

const projectFile = (path: string): string =>
  path.endsWith('.json') ? path : join(path, 'tsconfig.json');

const laterWins = (earlier: Aliases, later: Aliases): Aliases => ({ ...earlier, ...later });

const MOST_CONFIGS = 256;

const isRelativeName = (name: string): boolean => /^\.\.?\//.test(name);

type AliasReading = {
  readonly directory: string;
  readonly stays: (place: string) => boolean;
  readonly known: Map<string, Aliases>;
};

type Said = {
  readonly from: string;
  readonly baseUrl?: string | undefined;
  readonly paths?: Paths | undefined;
};

const saidIn = ({ from, baseUrl, paths }: Said): Aliases => ({
  ...(baseUrl === undefined || isAbsolute(baseUrl) ? {} : { baseUrl: join(from, baseUrl) }),
  ...(paths === undefined ? {} : { paths: { places: paths, from } }),
});

const chainAt = (reading: AliasReading, config: string): Aliases => {
  const { directory, stays, known } = reading;
  const already = known.get(config);
  if (already !== undefined) return already;
  if (known.size >= MOST_CONFIGS) return {};
  known.set(config, {});
  const { extends: extended = [], compilerOptions } = tsconfigAt(join(directory, config));
  const from = dirname(config);
  const aliases: Aliases = {
    ...[extended]
      .flat()
      .filter(isRelativeName)
      .map(name => join(from, withExtension(name)))
      .filter(stays)
      .map(name => chainAt(reading, name))
      .reduce(laterWins, {}),
    ...saidIn({ ...compilerOptions, from }),
  };
  known.set(config, aliases);
  return aliases;
};

const holdsNoFiles = ({ files, include }: z.infer<typeof TsconfigSchema>): boolean =>
  (files !== undefined || include !== undefined) &&
  (files ?? []).length === 0 &&
  (include ?? []).length === 0;

const rootAliases = (reading: AliasReading): Aliases => {
  const config = rootConfigIn(reading.directory);
  const chain = chainAt(reading, config);
  const root = tsconfigAt(join(reading.directory, config));
  if (chain.paths !== undefined || !holdsNoFiles(root)) return chain;
  const referenced = (root.references ?? [])
    .map(({ path }) => projectFile(path))
    .filter(reading.stays)
    .map(project => chainAt(reading, project));
  return referenced.find(({ paths }) => paths !== undefined) ?? chain;
};

type Folders = {
  readonly directory: string;
  readonly catchAll: ReadonlyArray<string>;
  readonly base: string | undefined;
};

const moduleFolders = ({ directory, catchAll, base }: Folders) => [
  ...catchAll
    .filter(place => basename(place) === '*')
    .map(place => join(directory, dirname(place))),
  ...(base === undefined ? [] : [join(directory, base)]),
  'node_modules',
  'node_modules/@types',
];

const aliasNameOf = (name: string): string => (name.includes('*') ? name : `${name}$`);

export const resolutionIn = ({ checkout, root }: RootOptions) => {
  const directory = join(checkout, root);
  const stays = staysInCheckout(root);
  const { baseUrl, paths: pathsSaid } = rootAliases({ directory, stays, known: new Map() });
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
        .filter(([name]) => !MATCHES_FILE_PATHS.test(name))
        .toSorted(([one], [other]) => prefixLength(other) - prefixLength(one))
        .map(([name, places]) => [
          aliasNameOf(name),
          placesOf(places).map(place => join(directory, place)),
        ]),
    ),
    modules: moduleFolders({ directory, catchAll: placesOf(paths['*'] ?? []), base }),
  };
};

export type Resolution = ReturnType<typeof resolutionIn>;

const captureOf = (name: string, specifier: string): string | undefined => {
  const [prefix = '', suffix] = name.split('*');
  if (suffix === undefined) return name === `${specifier}$` ? '' : undefined;
  return specifier.startsWith(prefix) && specifier.endsWith(suffix)
    ? specifier.slice(prefix.length, specifier.length - suffix.length)
    : undefined;
};

export const placesNamedBy = ({ alias, modules }: Resolution, specifier: string) => {
  const said = Object.entries(alias).flatMap(([name, places]) => {
    const capture = captureOf(name, specifier);
    return capture === undefined ? [] : [places.map(place => place.replace('*', () => capture))];
  });
  return said[0] ?? modules.map(folder => join(folder, specifier));
};

export const moduleOf = (path: string): string => {
  const stem = path.replace(/(\.d)?\.[cm]?[jt]sx?$/, '');
  return basename(stem) === 'index' ? dirname(stem) : stem;
};

export const moduleAt = (...path: ReadonlyArray<string>): string => moduleOf(resolve(...path));

export type Naming = { readonly specifier: string; readonly importer: string };

type Lookup = { readonly head: string; readonly resolution: Resolution };

export const modulesNamedBy = (
  { head, resolution }: Lookup,
  { specifier, importer }: Naming,
): ReadonlyArray<string> =>
  (specifier.startsWith('.')
    ? [join(head, dirname(importer), specifier)]
    : placesNamedBy(resolution, specifier)
  ).map(place => moduleAt(place));

const PackageSchema = z.object({ name: z.string().optional() });

export const packageNameIn = (directory: string): string | undefined => {
  const manifest = join(directory, 'package.json');
  return existsSync(manifest)
    ? PackageSchema.safeParse(parse(readFileSync(manifest, 'utf8'))).data?.name
    : undefined;
};
