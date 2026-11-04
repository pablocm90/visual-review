import { mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { git } from '../test-support/repos.ts';
import { pruneReviews } from './prune-reviews.ts';

const reviewsDirectory = () => {
  const directory = mkdtempSync(join(tmpdir(), 'visual-review-reviews-'));
  git(directory, 'init', '--quiet');
  return { directory, [Symbol.dispose]: () => rmSync(directory, { recursive: true, force: true }) };
};

const filesIn = (directory: string): ReadonlyArray<string> =>
  readdirSync(directory)
    .filter(file => file !== '.git')
    .toSorted();

const writePage = (
  directory: string,
  name: string,
  writtenAt: number,
  extensions: ReadonlyArray<string> = ['html', 'json', 'notes.json', 'review.json', 'serve'],
): void =>
  extensions.forEach(extension => {
    const file = join(directory, `${name}.${extension}`);
    writeFileSync(file, '');
    utimesSync(file, writtenAt, writtenAt);
  });

test('keeps the most recently written pages and deletes older ones with their data, any notes, any review and any lock', async () => {
  using reviews = reviewsDirectory();
  const { directory } = reviews;
  writePage(directory, 'a..oldest', 1_000, ['html', 'json']);
  writePage(directory, 'b..newest', 3_000);
  writePage(directory, 'c..middle', 2_000);
  writeFileSync(join(directory, 'scratch.txt'), '');

  await pruneReviews({ directory, keep: 1 });

  expect(filesIn(directory)).toEqual([
    'b..newest.html',
    'b..newest.json',
    'b..newest.notes.json',
    'b..newest.review.json',
    'b..newest.serve',
    'scratch.txt',
  ]);
});

const writeReviewOf = (
  directory: string,
  { name, pullRequest, writtenAt }: { name: string; pullRequest?: number; writtenAt: number },
): void => {
  const file = join(directory, `${name}.review.json`);
  writeFileSync(
    file,
    JSON.stringify({
      verdict: 'comment',
      reviewed: { range: name, ...(pullRequest === undefined ? {} : { pullRequest }) },
    }),
  );
  utimesSync(file, writtenAt, writtenAt);
};

test("a pull request's newest review outlives its page, whatever its age, and its older reviews go once their pages have", async () => {
  using reviews = reviewsDirectory();
  const { directory } = reviews;
  writePage(directory, 'a..shown', 9_000, ['html', 'json']);
  writePage(directory, 'a..kept', 8_000, ['html', 'json']);
  writeReviewOf(directory, { name: 'a..kept', pullRequest: 7, writtenAt: 1_000 });
  writePage(directory, 'a..newest', 3_000, ['html', 'json']);
  writeReviewOf(directory, { name: 'a..newest', pullRequest: 7, writtenAt: 3_000 });
  writePage(directory, 'a..older', 2_000, ['html', 'json']);
  writeReviewOf(directory, { name: 'a..older', pullRequest: 7, writtenAt: 2_000 });
  writeReviewOf(directory, { name: 'a..pageless', pullRequest: 7, writtenAt: 1_500 });
  writeReviewOf(directory, { name: 'b..other', pullRequest: 8, writtenAt: 500 });
  writePage(directory, 'c..range', 1_000, ['html', 'json']);
  writeReviewOf(directory, { name: 'c..range', writtenAt: 4_000 });

  await pruneReviews({ directory, keep: 2 });

  expect(filesIn(directory)).toEqual([
    'a..kept.html',
    'a..kept.json',
    'a..kept.review.json',
    'a..newest.review.json',
    'a..shown.html',
    'a..shown.json',
    'b..other.review.json',
  ]);
});

test('a review file git tracks is left alone and takes no place as the newest review', async () => {
  using reviews = reviewsDirectory();
  const { directory } = reviews;
  writeReviewOf(directory, { name: 'a..sent', pullRequest: 7, writtenAt: 1_000 });
  writeReviewOf(directory, { name: 'a..tracked', pullRequest: 7, writtenAt: 2_000 });
  git(directory, 'add', '--force', 'a..tracked.review.json');

  await pruneReviews({ directory, keep: 1 });

  expect(filesIn(directory)).toEqual(['a..sent.review.json', 'a..tracked.review.json']);
});
