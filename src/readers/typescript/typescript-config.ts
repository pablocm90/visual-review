import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
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
  include: z.array(z.string()).optional(),
});

const tsconfigAt = (tsconfig: string): z.infer<typeof TsconfigSchema> =>
  existsSync(tsconfig) && statSync(tsconfig).isFile()
    ? (TsconfigSchema.safeParse(parse(readFileSync(tsconfig, 'utf8'))).data ?? {})
    : {};

export const tsconfigIn = (directory: string): z.infer<typeof TsconfigSchema> =>
  tsconfigAt(join(directory, 'tsconfig.json'));

export type RootOptions = {
  readonly checkout: string;
  readonly root: string;
};

export const staysInCheckout = (root: string) => (place: string) =>
  !isAbsolute(place) && !`${join(root, place)}/`.startsWith('../');

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

const aliasesAt = (reading: AliasReading, config: string): Aliases => {
  const { directory, stays, known } = reading;
  const already = known.get(config);
  if (already !== undefined) return already;
  if (known.size >= MOST_CONFIGS) return {};
  known.set(config, {});
  const {
    extends: extended = [],
    references = [],
    compilerOptions,
  } = tsconfigAt(join(directory, config));
  const { baseUrl, paths } = compilerOptions ?? {};
  const from = dirname(config);
  const aliasesOf = (names: ReadonlyArray<string>): Aliases =>
    names
      .map(name => join(from, name))
      .filter(stays)
      .map(name => aliasesAt(reading, name))
      .reduce(laterWins, {});
  const chain: Aliases = {
    ...aliasesOf([extended].flat().filter(isRelativeName).map(withExtension)),
    ...(baseUrl === undefined || isAbsolute(baseUrl) ? {} : { baseUrl: join(from, baseUrl) }),
    ...(paths === undefined ? {} : { paths: { places: paths, from } }),
  };
  const aliases =
    chain.paths === undefined
      ? {
          ...chain,
          ...aliasesOf(
            references
              .map(({ path }) => path)
              .filter(path => !isAbsolute(path))
              .map(projectFile),
          ),
        }
      : chain;
  known.set(config, aliases);
  return aliases;
};

export const resolutionIn = ({ checkout, root }: RootOptions) => {
  const directory = join(checkout, root);
  const stays = staysInCheckout(root);
  const { baseUrl, paths: pathsSaid } = aliasesAt(
    { directory, stays, known: new Map() },
    'tsconfig.json',
  );
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
