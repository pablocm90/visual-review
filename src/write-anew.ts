import { randomBytes } from 'node:crypto';
import { rename, rm, writeFile } from 'node:fs/promises';

type WriteAnewOptions = {
  readonly path: string;
  readonly content: string;
  readonly mode?: number;
};

export const writeAnew = async ({ path, content, mode }: WriteAnewOptions): Promise<void> => {
  const temporary = `${path}.${randomBytes(8).toString('hex')}`;
  try {
    await writeFile(temporary, content, { mode });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
};
