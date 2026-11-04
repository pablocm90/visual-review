import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pageNameOf, pullRequestReviewsIn } from './last-review.ts';

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
  const sorted = pages.toSorted((one, other) => other.writtenAt - one.writtenAt);
  const shown = new Set(sorted.slice(0, keep).map(({ name }) => name));
  const reviews = await pullRequestReviewsIn(directory);
  const newest = new Set(
    [...Map.groupBy(reviews, ({ pullRequest }) => pullRequest).values()].map(
      ([review]) => review?.file,
    ),
  );
  const older = sorted
    .slice(keep)
    .flatMap(({ name }) =>
      ['html', 'json', 'notes.json', 'review.json', 'serve'].map(
        extension => `${name}.${extension}`,
      ),
    );
  const stale = reviews.map(({ file }) => file).filter(file => !shown.has(pageNameOf(file)));
  await Promise.all(
    [...older, ...stale]
      .filter(file => !newest.has(file))
      .map(file => rm(join(directory, file), { force: true })),
  );
};
