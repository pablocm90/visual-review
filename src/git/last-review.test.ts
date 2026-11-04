import { mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { git } from '../test-support/repos.ts';
import { lastReviewOf } from './last-review.ts';

const reviewsDirectory = () => {
  const directory = mkdtempSync(join(tmpdir(), 'visual-review-reviews-'));
  git(directory, 'init', '--quiet');
  return { directory, [Symbol.dispose]: () => rmSync(directory, { recursive: true, force: true }) };
};

type WrittenReview = {
  readonly head: string;
  readonly writtenAt: number;
  readonly verdict?: string;
  readonly pullRequest?: number;
};

const writeReview = (
  directory: string,
  { head, writtenAt, verdict = 'comment', pullRequest = 7 }: WrittenReview,
): void => {
  const file = join(directory, `base..${head}.review.json`);
  writeFileSync(
    file,
    JSON.stringify({ verdict, reviewed: { range: `base..${head}`, pullRequest } }),
  );
  utimesSync(file, writtenAt, writtenAt);
};

test("the newest review of the pull request at another head is the last one, the new head's own left out", async () => {
  using reviews = reviewsDirectory();
  const { directory } = reviews;
  writeReview(directory, { head: 'h0', writtenAt: 1_000, verdict: 'approve' });
  writeReview(directory, { head: 'h1', writtenAt: 2_000, verdict: 'request-changes' });
  writeReview(directory, { head: 'h2', writtenAt: 3_000 });

  await expect(lastReviewOf({ directory, pullRequest: 7, head: 'h2' })).resolves.toEqual({
    head: 'h1',
    verdict: 'request-changes',
  });
});

test('a review file git tracks came with the repo, so it is no last review, however new', async () => {
  using reviews = reviewsDirectory();
  const { directory } = reviews;
  writeReview(directory, { head: 'h0', writtenAt: 1_000 });
  writeReview(directory, { head: 'h1', writtenAt: 2_000, verdict: 'approve' });
  git(directory, 'add', '--force', 'base..h1.review.json');

  await expect(lastReviewOf({ directory, pullRequest: 7, head: 'h2' })).resolves.toEqual({
    head: 'h0',
    verdict: 'comment',
  });
});

test.for([
  {
    reason: "another pull request's",
    write: (directory: string) =>
      writeReview(directory, { head: 'h1', writtenAt: 1, pullRequest: 8 }),
  },
  {
    reason: 'a range with no pull request',
    write: (directory: string) =>
      writeFileSync(
        join(directory, 'a..b.review.json'),
        JSON.stringify({ verdict: 'comment', reviewed: { range: 'a..b' } }),
      ),
  },
  {
    reason: 'a file that is not JSON',
    write: (directory: string) => writeFileSync(join(directory, 'a..b.review.json'), '{'),
  },
  {
    reason: 'a file that is not a review',
    write: (directory: string) => writeFileSync(join(directory, 'a..b.review.json'), '{"a":1}'),
  },
  {
    reason: "a page's data, which isn't a review",
    write: (directory: string) =>
      writeFileSync(
        join(directory, 'a..b.json'),
        JSON.stringify({ verdict: 'comment', reviewed: { range: 'a..b', pullRequest: 7 } }),
      ),
  },
])('$reason is no last review', async ({ write }) => {
  using reviews = reviewsDirectory();
  const { directory } = reviews;
  write(directory);

  await expect(lastReviewOf({ directory, pullRequest: 7, head: 'h2' })).resolves.toBeUndefined();
});

test('a review in an older format still counts, whatever else it holds', async () => {
  using reviews = reviewsDirectory();
  const { directory } = reviews;
  writeFileSync(
    join(directory, 'base..h1.review.json'),
    JSON.stringify({
      version: 3,
      verdict: 'approve',
      reviewed: { range: 'base..h1', pullRequest: 7, somethingOld: true },
      comments: [{ on: 'old shape' }],
    }),
  );

  await expect(lastReviewOf({ directory, pullRequest: 7, head: 'h2' })).resolves.toEqual({
    head: 'h1',
    verdict: 'approve',
  });
});

test('with no reviews directory there is no last review', async () => {
  using reviews = reviewsDirectory();
  const directory = join(reviews.directory, 'missing');

  await expect(lastReviewOf({ directory, pullRequest: 7, head: 'h2' })).resolves.toBeUndefined();
});

test("a review file that can't be read is skipped, not a failed review", async () => {
  using reviews = reviewsDirectory();
  const { directory } = reviews;
  writeReview(directory, { head: 'h1', writtenAt: 1_000 });
  symlinkSync('missing', join(directory, 'base..h2.review.json'));

  await expect(lastReviewOf({ directory, pullRequest: 7, head: 'h3' })).resolves.toEqual({
    head: 'h1',
    verdict: 'comment',
  });
});
