import { readFile, stat } from 'node:fs/promises';

export const readFileThatEnds = async (path: string): Promise<string> => {
  const stats = await stat(path);
  if (!stats.isFile() || stats.size === 0)
    throw new Error(`${path}: not a regular file with contents`);
  return readFile(path, 'utf8');
};
