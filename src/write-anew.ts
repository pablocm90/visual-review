import { randomBytes } from 'node:crypto';
import { chmod, lstat, rename, rm, writeFile } from 'node:fs/promises';

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
    const kept = mode ?? (await modeOfFileAt(path));
    await writeFile(temporary, content, { mode: kept });
    if (kept !== undefined) await chmod(temporary, kept);
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
};
