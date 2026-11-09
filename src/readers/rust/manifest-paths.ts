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
    })
    .optional(),
});

const workspaceOf = (manifest: string, toml: unknown): ReadonlyArray<Named> => {
  const { data: read, error } = Manifest.safeParse(toml);
  const [issue] = error?.issues ?? [];
  if (issue !== undefined)
    throw new StackNotRead(`${manifest}: ${issue.path.join('.')}: ${issue.message}`);
  return [
    ...(['package', 'project'] as const).flatMap(table => {
      const workspace = read?.[table]?.workspace;
      return workspace === undefined
        ? []
        : [{ key: `${table}.workspace`, path: workspace, pattern: false }];
    }),
    ...(['members', 'default-members'] as const).flatMap(key =>
      (read?.workspace?.[key] ?? []).map(path => ({
        key: `workspace.${key}`,
        path,
        pattern: true,
      })),
    ),
  ];
};

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
  const read = parsed(manifest, await readFile(join(folder, 'Cargo.toml'), 'utf8'));
  const paths = [...pathsIn(read), ...workspaceOf(manifest, read)];
  const left = await Promise.all(paths.map(named => leaves(named, { checkout, folder })));
  const leaving = paths.find((_, index) => left[index]);
  if (leaving !== undefined)
    throw new StackNotRead(
      `${manifest}: ${leaving.key} ${JSON.stringify(leaving.path)} leaves the checkout`,
    );
  return paths
    .flatMap(({ path, pattern }) =>
      pattern ? foldersMatching(folder, path) : [resolve(folder, path)],
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

export const refuseLeavingPaths = ({ checkout, root }: ManifestOptions): Promise<void> =>
  walk({ checkout, folders: [resolve(checkout, root)], seen: new Set() });
