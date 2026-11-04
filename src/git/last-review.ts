import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ReviewedHead } from '../core/read-range.ts';
import { pastReviewOf } from '../core/review.ts';

type LastReviewOptions = {
  readonly directory: string;
  readonly pullRequest: number;
  readonly head: string;
};

const headOfRange = (range: string): string => range.slice(range.lastIndexOf('..') + 2);

export const lastReviewOf = async ({
  directory,
  pullRequest,
  head,
}: LastReviewOptions): Promise<ReviewedHead | undefined> => {
  const files = await readdir(directory).catch(() => []);
  const reviews = await Promise.all(
    files
      .filter(file => file.endsWith('.review.json'))
      .map(async file => {
        const path = join(directory, file);
        const past = pastReviewOf(await readFile(path, 'utf8'));
        if (past?.reviewed.pullRequest !== pullRequest) return [];
        const writtenAt = (await stat(path)).mtimeMs;
        return [{ head: headOfRange(past.reviewed.range), verdict: past.verdict, writtenAt }];
      }),
  );
  const newest = reviews
    .flat()
    .filter(review => review.head !== head)
    .toSorted((one, other) => other.writtenAt - one.writtenAt)[0];
  return newest && { head: newest.head, verdict: newest.verdict };
};
