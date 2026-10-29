import { globSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export type SourceFile = {
  readonly file: string;
  readonly text: string;
};

export const sourcesIn = (
  directory: string,
  pattern: string | ReadonlyArray<string>,
): Promise<ReadonlyArray<SourceFile>> =>
  Promise.all(
    globSync(pattern, { cwd: directory }).map(async file => ({
      file,
      text: await readFile(join(directory, file), 'utf8'),
    })),
  );
