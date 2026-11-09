import { existsSync, readdirSync, statSync } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { parse, TomlError } from 'smol-toml';
import { z } from 'zod';
import { resolvesInside } from '../../core/links-leaving.ts';
import { StackNotRead } from '../../core/skipped.ts';

type Named = { readonly key: string; readonly path: string; readonly pattern: boolean };

const pathsIn = (value: unknown): ReadonlyArray<Named> => {
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, inner]) =>
    key === 'path' && typeof inner === 'string'
      ? [{ key, path: inner, pattern: false }]
      : pathsIn(inner),
  );
};

const Manifest = z.object({
  package: z.object({ workspace: z.string().optional() }).optional(),
  project: z.object({ workspace: z.string().optional() }).optional(),
  workspace: z
    .object({
      members: z.array(z.string()).optional(),
      'default-members': z.array(z.string()).optional(),
      exclude: z.array(z.string()).optional(),
    })
    .optional(),
});

type Read = z.infer<typeof Manifest>;

const manifestOf = (manifest: string, toml: unknown): Read => {
  const read = Manifest.safeParse(toml);
  if (read.success) return read.data;
  const [issue] = read.error.issues;
  throw new StackNotRead(`${manifest}: ${issue?.path.join('.')}: ${issue?.message}`);
};

const workspaceOf = (read: Read): ReadonlyArray<Named> => [
  ...(['package', 'project'] as const).flatMap(table => {
    const workspace = read[table]?.workspace;
    return workspace === undefined
      ? []
      : [{ key: `${table}.workspace`, path: workspace, pattern: false }];
  }),
  ...(['members', 'default-members'] as const).flatMap(key =>
    (read.workspace?.[key] ?? []).map(path => ({
      key: `workspace.${key}`,
      path,
      pattern: true,
    })),
  ),
];

const holds = (folder: string, path: string): boolean =>
  relative(folder, path).split('/')[0] !== '..';

const climbs = (path: string): boolean => path.split('/').includes('..');

const excludedFrom =
  (folder: string, { workspace }: Read) =>
  (path: string): boolean =>
    (workspace?.exclude ?? [])
      .filter(excluded => !climbs(excluded))
      .some(excluded => holds(resolve(folder, excluded), path)) &&
    !(workspace?.members ?? []).some(member => holds(resolve(folder, member), path));

const parsed = (manifest: string, text: string): unknown => {
  try {
    return parse(text);
  } catch (error) {
    if (error instanceof TomlError)
      throw new StackNotRead(`${manifest}: ${error.message.split('\n')[0]}`);
    throw error;
  }
};

type ManifestOptions = {
  readonly checkout: string;
  readonly root: string;
};

const isGlobbed = (segment: string): boolean => /[*?[]/.test(segment);

const literalPrefixOf = (pattern: string): string => {
  const segments = pattern.split('/');
  const globbed = segments.findIndex(isGlobbed);
  return globbed === -1 ? pattern : segments.slice(0, globbed).join('/');
};

const climbsOutOfGlob = (pattern: string): boolean =>
  pattern.slice(literalPrefixOf(pattern).length).split('/').includes('..');

const childFolders = (folder: string): ReadonlyArray<string> =>
  statSync(folder, { throwIfNoEntry: false })?.isDirectory()
    ? readdirSync(folder).map(name => join(folder, name))
    : [];

const foldersMatching = (folder: string, pattern: string): ReadonlyArray<string> => {
  const prefix = literalPrefixOf(pattern);
  return pattern
    .slice(prefix.length)
    .split('/')
    .reduce<ReadonlyArray<string>>(
      (folders, segment) =>
        isGlobbed(segment)
          ? folders.flatMap(childFolders)
          : folders.map(found => join(found, segment)),
      [resolve(folder, prefix)],
    );
};

type Place = { readonly checkout: string; readonly folder: string };

const leaves = async ({ path, pattern }: Named, { checkout, folder }: Place): Promise<boolean> => {
  if (!pattern) return !(await resolvesInside(checkout, resolve(folder, path)));
  return (
    climbsOutOfGlob(path) ||
    !(await resolvesInside(checkout, resolve(folder, literalPrefixOf(path))))
  );
};

const followedFrom = async ({ checkout, folder }: Place): Promise<ReadonlyArray<string>> => {
  const manifest = relative(checkout, join(folder, 'Cargo.toml'));
  const toml = parsed(manifest, await readFile(join(folder, 'Cargo.toml'), 'utf8'));
  const read = manifestOf(manifest, toml);
  const excluded = excludedFrom(folder, read);
  const paths = [...pathsIn(toml), ...workspaceOf(read)];
  const left = await Promise.all(paths.map(named => leaves(named, { checkout, folder })));
  const leaving = paths.find((_, index) => left[index]);
  if (leaving !== undefined)
    throw new StackNotRead(
      `${manifest}: ${leaving.key} ${JSON.stringify(leaving.path)} leaves the checkout`,
    );
  return paths
    .flatMap(({ path, pattern }) =>
      pattern
        ? foldersMatching(folder, path).filter(match => climbs(path) || !excluded(match))
        : [resolve(folder, path)],
    )
    .filter(path => existsSync(join(path, 'Cargo.toml')));
};

type Walk = {
  readonly checkout: string;
  readonly folders: ReadonlyArray<string>;
  readonly seen: ReadonlySet<string>;
};

const walk = async ({ checkout, folders, seen }: Walk): Promise<void> => {
  const [folder, ...rest] = folders;
  if (folder === undefined) return;
  const real = await realpath(folder);
  if (seen.has(real)) return walk({ checkout, folders: rest, seen });
  const followed = await followedFrom({ checkout, folder });
  return walk({ checkout, folders: [...rest, ...followed], seen: new Set([...seen, real]) });
};

const foldersAbove = (checkout: string, folder: string): ReadonlyArray<string> => {
  const segments = relative(checkout, folder).split('/');
  return segments.map((_, index) => join(checkout, ...segments.slice(0, index)));
};

export const refuseLeavingPaths = ({ checkout, root }: ManifestOptions): Promise<void> => {
  const folder = resolve(checkout, root);
  const above = foldersAbove(checkout, folder).filter(up => existsSync(join(up, 'Cargo.toml')));
  return walk({ checkout, folders: [folder, ...above], seen: new Set() });
};
