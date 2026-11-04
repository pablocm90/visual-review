import { randomBytes } from 'node:crypto';
import { lstat, rename, rm, writeFile } from 'node:fs/promises';

type WriteAnewOptions = {
  readonly path: string;
  readonly content: string;
  readonly mode?: number;
};

const modeOfFileAt = async (path: string): Promise<number | undefined> => {
  const standing = await lstat(path).catch(() => undefined);
  return standing?.isFile() ? standing.mode & 0o777 : undefined;
};

export const writeAnew = async ({ path, content, mode }: WriteAnewOptions): Promise<void> => {
  const temporary = `${path}.${randomBytes(8).toString('hex')}`;
  try {
    await writeFile(temporary, content, { mode: mode ?? (await modeOfFileAt(path)) });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
};
