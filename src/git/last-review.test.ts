import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { git, gitRepo } from '../test-support/repos.ts';
import { lastReviewOf } from './last-review.ts';

const H0 = '0'.repeat(40);
const H1 = '1'.repeat(40);
const H2 = '2'.repeat(40);
const H3 = '3'.repeat(40);

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
  writeReview(directory, { head: H0, writtenAt: 1_000, verdict: 'approve' });
  writeReview(directory, { head: H1, writtenAt: 2_000, verdict: 'request-changes' });
  writeReview(directory, { head: H2, writtenAt: 3_000 });

  await expect(lastReviewOf({ directory, pullRequest: 7, head: H2 })).resolves.toEqual({
    head: H1,
    verdict: 'request-changes',
  });
});

test('a review file git tracks came with the repo, so it is no last review, however new', async () => {
  using reviews = reviewsDirectory();
  const { directory } = reviews;
  writeReview(directory, { head: H0, writtenAt: 1_000 });
  writeReview(directory, { head: H1, writtenAt: 2_000, verdict: 'approve' });
  git(directory, 'add', '--force', `base..${H1}.review.json`);

  await expect(lastReviewOf({ directory, pullRequest: 7, head: H2 })).resolves.toEqual({
    head: H0,
    verdict: 'comment',
  });
});

test.for([
  {
    reason: "another pull request's",
    write: (directory: string) =>
      writeReview(directory, { head: H1, writtenAt: 1, pullRequest: 8 }),
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
    reason: 'a file in a folder under the reviews',
    write: (directory: string) => {
      mkdirSync(join(directory, 'sub'));
      writeReview(join(directory, 'sub'), { head: H1, writtenAt: 1 });
    },
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

  await expect(lastReviewOf({ directory, pullRequest: 7, head: H2 })).resolves.toBeUndefined();
});

test('a review in an older format still counts, whatever else it holds', async () => {
  using reviews = reviewsDirectory();
  const { directory } = reviews;
  writeFileSync(
    join(directory, `base..${H1}.review.json`),
    JSON.stringify({
      version: 3,
      verdict: 'approve',
      reviewed: { range: `base..${H1}`, pullRequest: 7, somethingOld: true },
      comments: [{ on: 'old shape' }],
    }),
  );

  await expect(lastReviewOf({ directory, pullRequest: 7, head: H2 })).resolves.toEqual({
    head: H1,
    verdict: 'approve',
  });
});

test("a tag object of the new head names the new head, so it's left out as its own review", async () => {
  using repository = gitRepo({ a: '' });
  const directory = join(repository.repo, '.reviews');
  mkdirSync(directory);
  git(repository.repo, 'tag', '--annotate', '--message', 'tag', 'tag');
  const tag = git(repository.repo, 'rev-parse', 'tag');
  writeReview(directory, { head: tag, writtenAt: 1_000 });

  await expect(
    lastReviewOf({ directory, pullRequest: 7, head: repository.root }),
  ).resolves.toBeUndefined();
});

test.for([
  { reason: 'a revision that is no full SHA', head: 'HEAD~0' },
  { reason: 'a short SHA', head: '1'.repeat(39) },
  { reason: 'a SHA too long', head: '1'.repeat(41) },
  { reason: 'a SHA between the two lengths', head: '1'.repeat(63) },
  { reason: 'uppercase hex', head: 'A'.repeat(40) },
  { reason: 'a SHA with more after it', head: `${H1}\nHEAD` },
  { reason: 'an option', head: '--output=x' },
])('a review whose head is $reason is no last review', async ({ head }) => {
  using reviews = reviewsDirectory();
  const { directory } = reviews;
  writeFileSync(
    join(directory, 'a.review.json'),
    JSON.stringify({ verdict: 'comment', reviewed: { range: `base..${head}`, pullRequest: 7 } }),
  );

  await expect(lastReviewOf({ directory, pullRequest: 7, head: H2 })).resolves.toBeUndefined();
});

test('a review of a SHA-256 head counts', async () => {
  using reviews = reviewsDirectory();
  const { directory } = reviews;
  const head = '1'.repeat(64);
  writeReview(directory, { head, writtenAt: 1_000 });

  await expect(lastReviewOf({ directory, pullRequest: 7, head: H2 })).resolves.toEqual({
    head,
    verdict: 'comment',
  });
});

test('with no reviews directory there is no last review', async () => {
  using reviews = reviewsDirectory();
  const directory = join(reviews.directory, 'missing');

  await expect(lastReviewOf({ directory, pullRequest: 7, head: H2 })).resolves.toBeUndefined();
});

test("a review file that can't be read is skipped, not a failed review", async () => {
  using reviews = reviewsDirectory();
  const { directory } = reviews;
  writeReview(directory, { head: H1, writtenAt: 1_000 });
  symlinkSync('missing', join(directory, `base..${H2}.review.json`));

  await expect(lastReviewOf({ directory, pullRequest: 7, head: H3 })).resolves.toEqual({
    head: H1,
    verdict: 'comment',
  });
});
