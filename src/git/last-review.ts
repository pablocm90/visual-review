import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { ReviewedHead } from '../core/read-range.ts';
import { pastReviewOf } from '../core/review.ts';

const run = promisify(execFile);

const headOfRange = (range: string): string => range.slice(range.lastIndexOf('..') + 2);

const FULL_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

const REVIEW = '.review.json';

export const pageNameOf = (reviewFile: string): string => reviewFile.slice(0, -REVIEW.length);

type PullRequestReview = ReviewedHead & {
  readonly file: string;
  readonly pullRequest: number;
  readonly writtenAt: number;
};

const pullRequestReviewIn = async (
  directory: string,
  file: string,
): Promise<ReadonlyArray<PullRequestReview>> => {
  const path = join(directory, file);
  const past = pastReviewOf(await readFile(path, 'utf8'));
  if (past?.reviewed.pullRequest === undefined) return [];
  const head = headOfRange(past.reviewed.range);
  if (!FULL_SHA.test(head)) return [];
  return [
    {
      file,
      head,
      verdict: past.verdict,
      pullRequest: past.reviewed.pullRequest,
      writtenAt: (await stat(path)).mtimeMs,
    },
  ];
};

const untrackedFilesIn = async (directory: string): Promise<ReadonlyArray<string>> => {
  const listed = await run('git', ['-C', directory, 'ls-files', '-z', '--others']).catch(() => ({
    stdout: '',
  }));
  return listed.stdout.split('\0');
};

export const pullRequestReviewsIn = async (
  directory: string,
): Promise<ReadonlyArray<PullRequestReview>> => {
  const files = await untrackedFilesIn(directory);
  const reviews = await Promise.all(
    files
      .filter(file => file.endsWith(REVIEW))
      .map(file => pullRequestReviewIn(directory, file).catch(() => [])),
  );
  return reviews.flat().toSorted((one, other) => other.writtenAt - one.writtenAt);
};

type LastReviewOptions = {
  readonly directory: string;
  readonly pullRequest: number;
  readonly head: string;
};

export const lastReviewOf = async ({
  directory,
  pullRequest,
  head,
}: LastReviewOptions): Promise<ReviewedHead | undefined> => {
  const last = (await pullRequestReviewsIn(directory)).find(
    review => review.pullRequest === pullRequest && review.head !== head,
  );
  return last && { head: last.head, verdict: last.verdict };
};
