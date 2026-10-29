import { mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { pruneReviews } from './prune-reviews.ts';

const reviewsDirectory = () => {
  const directory = mkdtempSync(join(tmpdir(), 'visual-review-reviews-'));
  return { directory, [Symbol.dispose]: () => rmSync(directory, { recursive: true, force: true }) };
};

const writePage = (
  directory: string,
  name: string,
  writtenAt: number,
  extensions: ReadonlyArray<string> = ['html', 'json', 'notes.json'],
): void =>
  extensions.forEach(extension => {
    const file = join(directory, `${name}.${extension}`);
    writeFileSync(file, '');
    utimesSync(file, writtenAt, writtenAt);
  });

test('keeps the most recently written pages and deletes older ones with their data and any notes', async () => {
  using reviews = reviewsDirectory();
  const { directory } = reviews;
  writePage(directory, 'a..oldest', 1_000, ['html', 'json']);
  writePage(directory, 'b..newest', 3_000);
  writePage(directory, 'c..middle', 2_000);
  writeFileSync(join(directory, 'scratch.txt'), '');

  await pruneReviews({ directory, keep: 1 });

  expect(readdirSync(directory).sort()).toEqual([
    'b..newest.html',
    'b..newest.json',
    'b..newest.notes.json',
    'scratch.txt',
  ]);
});
