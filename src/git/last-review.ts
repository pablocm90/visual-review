import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { type ReviewedHead, resolve } from '../core/read-range.ts';
import { pastReviewOf } from '../core/review.ts';

const run = promisify(execFile);

const headOfRange = (range: string): string => range.slice(range.lastIndexOf('..') + 2);

const FULL_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

const REVIEWS = '.reviews';

const REVIEW = '.review.json';

export const reviewsDirectoryOf = (repo: string): string => join(repo, REVIEWS);

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

const untrackedReviewFilesOf = async (repo: string): Promise<ReadonlyArray<string>> => {
  const { stdout } = await run('git', ['-C', repo, 'ls-files', '-z', '--others', '--', REVIEWS]);
  return stdout.split('\0').map(path => path.slice(REVIEWS.length + 1));
};

export const pullRequestReviewsIn = async (
  repo: string,
): Promise<ReadonlyArray<PullRequestReview>> => {
  const directory = reviewsDirectoryOf(repo);
  const files = await untrackedReviewFilesOf(repo);
  const reviews = await Promise.all(
    files
      .filter(file => file.endsWith(REVIEW) && !file.includes('/'))
      .map(file => pullRequestReviewIn(directory, file).catch(() => [])),
  );
  return reviews.flat().toSorted((one, other) => other.writtenAt - one.writtenAt);
};

type LastReviewOptions = {
  readonly repo: string;
  readonly pullRequest: number;
  readonly head: string;
};

export const lastReviewOf = async ({
  repo,
  pullRequest,
  head,
}: LastReviewOptions): Promise<ReviewedHead | undefined> => {
  const reviews = (await pullRequestReviewsIn(repo)).filter(
    review => review.pullRequest === pullRequest,
  );
  const commits = await Promise.all(
    reviews.map(review => resolve(repo, review.head).catch(() => review.head)),
  );
  const last = reviews.find((_, index) => commits[index] !== head);
  return last && { head: last.head, verdict: last.verdict };
};
