import { globSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parse, TomlError } from 'smol-toml';
import { z } from 'zod';
import { resolvesInside } from '../../core/links-leaving.ts';
import { StackNotRead } from '../../core/skipped.ts';

type Named = { readonly key: string; readonly path: string };

const pathsIn = (value: unknown): ReadonlyArray<Named> => {
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, inner]) =>
    key === 'path' && typeof inner === 'string' ? [{ key, path: inner }] : pathsIn(inner),
  );
};

const Manifest = z.object({
  package: z.object({ workspace: z.string().optional() }).optional(),
  workspace: z
    .object({
      members: z.array(z.string()).optional(),
      'default-members': z.array(z.string()).optional(),
    })
    .optional(),
});

const workspaceOf = (manifest: unknown): ReadonlyArray<Named> => {
  const read = Manifest.safeParse(manifest).data;
  const workspace = read?.package?.workspace;
  return [
    ...(workspace === undefined ? [] : [{ key: 'package.workspace', path: workspace }]),
    ...(['members', 'default-members'] as const).flatMap(key =>
      (read?.workspace?.[key] ?? []).map(path => ({ key: `workspace.${key}`, path })),
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

const literalPrefixOf = (pattern: string): string => {
  const segments = pattern.split('/');
  const globbed = segments.findIndex(segment => /[*?[]/.test(segment));
  return globbed === -1 ? pattern : segments.slice(0, globbed).join('/');
};

const leaves = async (pattern: string, { checkout, root }: ManifestOptions): Promise<boolean> => {
  const folder = resolve(checkout, root);
  const prefix = literalPrefixOf(pattern);
  if (!(await resolvesInside(checkout, resolve(folder, prefix)))) return true;
  const matches = globSync(pattern, { cwd: folder });
  const inside = await Promise.all(
    matches.map(match => resolvesInside(checkout, resolve(folder, match))),
  );
  return inside.includes(false);
};

export const refuseLeavingPaths = async (options: ManifestOptions): Promise<void> => {
  const manifest = join(options.root, 'Cargo.toml');
  const read = parsed(manifest, await readFile(join(options.checkout, manifest), 'utf8'));
  const paths = [...pathsIn(read), ...workspaceOf(read)];
  const left = await Promise.all(paths.map(({ path }) => leaves(path, options)));
  const leaving = paths.find((_, index) => left[index]);
  if (leaving !== undefined)
    throw new StackNotRead(
      `${manifest}: ${leaving.key} ${JSON.stringify(leaving.path)} leaves the checkout`,
    );
};
