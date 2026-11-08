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

const Manifest = z.object({ package: z.object({ workspace: z.string().optional() }).optional() });

const workspaceOf = (manifest: unknown): ReadonlyArray<Named> => {
  const workspace = Manifest.safeParse(manifest).data?.package?.workspace;
  return workspace === undefined ? [] : [{ key: 'package.workspace', path: workspace }];
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

export const refuseLeavingPaths = async ({ checkout, root }: ManifestOptions): Promise<void> => {
  const manifest = join(root, 'Cargo.toml');
  const read = parsed(manifest, await readFile(join(checkout, manifest), 'utf8'));
  const paths = [...pathsIn(read), ...workspaceOf(read)];
  const inside = await Promise.all(
    paths.map(({ path }) => resolvesInside(checkout, resolve(checkout, root, path))),
  );
  const leaving = paths.find((_, index) => !inside[index]);
  if (leaving !== undefined)
    throw new StackNotRead(
      `${manifest}: ${leaving.key} ${JSON.stringify(leaving.path)} leaves the checkout`,
    );
};
