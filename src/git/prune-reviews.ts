import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

type PruneReviewsOptions = {
  readonly directory: string;
  readonly keep: number;
};

export const pruneReviews = async ({ directory, keep }: PruneReviewsOptions): Promise<void> => {
  const pages = await Promise.all(
    (await readdir(directory))
      .filter(file => file.endsWith('.html'))
      .map(async file => ({
        name: file.slice(0, -'.html'.length),
        writtenAt: (await stat(join(directory, file))).mtimeMs,
      })),
  );
  const older = pages.toSorted((one, other) => other.writtenAt - one.writtenAt).slice(keep);
  await Promise.all(
    older.flatMap(({ name }) =>
      ['html', 'json', 'notes.json'].map(extension =>
        rm(join(directory, `${name}.${extension}`), { force: true }),
      ),
    ),
  );
};
