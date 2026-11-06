import { realpath, rm } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { gitUntrimmed } from './git.ts';

const LINK_MODE = '120000';

const linksAt = async (repo: string, revision: string): Promise<ReadonlyArray<string>> =>
  (await gitUntrimmed(repo, 'ls-tree', '-r', '-z', revision))
    .split('\0')
    .filter(entry => entry.startsWith(`${LINK_MODE} `))
    .map(entry => entry.slice(entry.indexOf('\t') + 1));

export const resolvesInside = async (root: string, path: string): Promise<boolean> => {
  const resolved = await realpath(join(root, path)).catch(() => undefined);
  return resolved?.startsWith(`${root}${sep}`) === true;
};

type DropLinksOptions = {
  readonly repo: string;
  readonly revision: string;
  readonly directory: string;
};

export const dropLinksLeaving = async ({
  repo,
  revision,
  directory,
}: DropLinksOptions): Promise<void> => {
  const links = await linksAt(repo, revision);
  await Promise.all(
    links.map(async link => {
      if (!(await resolvesInside(directory, link)))
        await rm(join(directory, link), { force: true });
    }),
  );
};
