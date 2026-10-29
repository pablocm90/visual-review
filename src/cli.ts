#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { diffGraphs, splitPatches } from './core/diff-graphs.ts';
import { notesProblems, readNotes } from './core/notes.ts';
import { readRange } from './core/read-range.ts';
import type { ReviewData } from './core/review-data.ts';
import { notReadLine } from './core/skipped.ts';
import { onPath } from './git/on-path.ts';
import { pruneReviews } from './git/prune-reviews.ts';
import { readPullRequest } from './git/pull-request.ts';
import { snapshotWorkingTree } from './git/working-tree.ts';

const slot = (id: string, content: string) =>
  `<script type="application/json" id="${id}">${content}</script>`;

const fillSlot = (html: string, id: string, value: unknown): string =>
  html.replace(new RegExp(slot(id, '[\\s\\S]*?')), () =>
    slot(id, JSON.stringify(value).replaceAll('<', '\\u003c')),
  );

const isDirectoryOrMissing = (path: string): Promise<boolean> =>
  lstat(path).then(
    stats => stats.isDirectory(),
    () => true,
  );

const parseRange = (range: string) => {
  const match = /^(.+?)\.\.(.+)$/.exec(range);
  if (!match?.[1] || !match[2])
    throw new Error('Usage: visual-review [<from>..<to> | <pr number>]');
  return { from: match[1], to: match[2] };
};

const requireOnPath = (command: string, installFrom: string): void => {
  if (!onPath(command))
    throw new Error(`${command} not found on PATH: install it from ${installFrom}`);
};

const rangeOf = async (repo: string, argument: string | undefined) => {
  if (argument === undefined) {
    return { range: 'HEAD..worktree', from: 'HEAD', to: await snapshotWorkingTree(repo) };
  }
  if (/^\d+$/.test(argument)) {
    requireOnPath('gh', 'https://cli.github.com');
    const { from, to, ...pullRequest } = await readPullRequest({ repo, number: Number(argument) });
    return { range: `${from}..${to}`, from, to, pullRequest };
  }
  return { range: argument, ...parseRange(argument) };
};

const viewerWith = async (review: ReviewData): Promise<string> =>
  fillSlot(
    await readFile(join(import.meta.dirname, '..', 'dist', 'viewer.html'), 'utf8'),
    'review-data',
    review,
  );

type FillNotesOptions = {
  readonly range: string;
  readonly page: string;
  readonly data: string;
  readonly notesFile: string;
};

const fillNotes = async ({ range, page, data, notesFile }: FillNotesOptions): Promise<void> => {
  const notes = await readNotes(notesFile);
  const review: ReviewData = JSON.parse(
    await readFile(data, 'utf8').catch(() => {
      throw new Error(`No page for ${range} yet: run visual-review without --notes first`);
    }),
  );
  const problems = notesProblems({ diff: review.diff, notes });
  if (problems.length > 0) {
    throw new Error(`Notes in ${notesFile} don't match the graph:\n${problems.join('\n')}`);
  }
  await writeFile(page, fillSlot(await readFile(page, 'utf8'), 'review-notes', notes));
};

const writeReview = async (args: ReadonlyArray<string>): Promise<string> => {
  const { positionals, values } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: { notes: { type: 'string' } },
  });
  requireOnPath('git', 'https://git-scm.com/downloads');
  const repo = (await promisify(execFile)('git', ['rev-parse', '--show-toplevel'])).stdout.trim();
  const { range, from, to, ...pullRequest } = await rangeOf(repo, positionals[0]);
  const directory = join(repo, '.reviews');
  if (!(await isDirectoryOrMissing(directory)))
    throw new Error(`${directory} is not a directory, so no page is written into it`);
  const name = range.replaceAll('/', '_');
  const page = join(directory, `${name}.html`);
  const data = join(directory, `${name}.json`);
  if (values.notes !== undefined) {
    await fillNotes({ range, page, data, notesFile: values.notes });
    return page;
  }
  const reading = await readRange({ repo, from, to });
  reading.skipped.forEach(skip => {
    console.error(notReadLine(skip));
  });
  const diff = diffGraphs(reading);
  const { drawn, undrawn } = splitPatches({ diff, patches: reading.patches });
  const review = {
    range,
    ...pullRequest,
    diff,
    dangling: reading.danglingCalls,
    patches: drawn,
    undrawn,
    tests: reading.tests,
    ...(reading.skipped.length === 0 ? {} : { skipped: reading.skipped }),
  };
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, '.gitignore'), '*\n');
  await writeFile(data, JSON.stringify(review));
  await writeFile(page, await viewerWith(review));
  await pruneReviews({ directory, keep: 20 });
  return page;
};

writeReview(process.argv.slice(2)).then(
  page => console.log(page),
  (error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
  },
);
