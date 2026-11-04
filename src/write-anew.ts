import { rm, writeFile } from 'node:fs/promises';

type WriteAnewOptions = {
  readonly path: string;
  readonly content: string;
  readonly mode?: number;
};

export const writeAnew = async ({ path, content, mode }: WriteAnewOptions): Promise<void> => {
  await rm(path, { force: true });
  await writeFile(path, content, { mode, flag: 'wx' });
};
