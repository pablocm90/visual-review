#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { z } from 'zod';
import { linkers, readers } from './adapters.ts';
import { parseNotes } from './core/notes.ts';
import { notedPageHtml, type PageData, type PullRequest, pageData, pageHtml } from './core/page.ts';
import { readRange } from './core/read-range.ts';
import { notReadLine } from './core/skipped.ts';
import { onPath } from './git/on-path.ts';
import { pruneReviews } from './git/prune-reviews.ts';
import { readPullRequest } from './git/pull-request.ts';
import { snapshotWorkingTree } from './git/working-tree.ts';

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

type ReviewedRange = {
  readonly range: string;
  readonly from: string;
  readonly to: string;
  readonly pullRequest?: PullRequest;
};

const rangeOf = async (repo: string, argument: string | undefined): Promise<ReviewedRange> => {
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

const viewerWith = async (data: PageData): Promise<string> =>
  pageHtml({
    viewer: await readFile(join(import.meta.dirname, '..', 'dist', 'viewer.html'), 'utf8'),
    data,
  });

const PackageSchema = z.object({ version: z.string() });

const ownVersion = async (): Promise<string> =>
  PackageSchema.parse(
    JSON.parse(await readFile(join(import.meta.dirname, '..', 'package.json'), 'utf8')),
  ).version;

type FillNotesOptions = {
  readonly range: string;
  readonly page: string;
  readonly notesFile: string;
};

const fillNotes = async ({ range, page, notesFile }: FillNotesOptions): Promise<void> => {
  const notes = parseNotes({ text: await readFile(notesFile, 'utf8'), file: notesFile });
  const written = await readFile(page, 'utf8').catch(() => {
    throw new Error(`No page for ${range} yet: run visual-review without --notes first`);
  });
  await writeFile(
    page,
    notedPageHtml({ page: written, notes, notesFile, version: await ownVersion() }),
  );
};

const writeReview = async (args: ReadonlyArray<string>): Promise<string> => {
  const { positionals, values } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: { notes: { type: 'string' } },
  });
  requireOnPath('git', 'https://git-scm.com/downloads');
  const repo = (await promisify(execFile)('git', ['rev-parse', '--show-toplevel'])).stdout.trim();
  const { range, from, to, pullRequest } = await rangeOf(repo, positionals[0]);
  const directory = join(repo, '.reviews');
  if (!(await isDirectoryOrMissing(directory)))
    throw new Error(`${directory} is not a directory, so no page is written into it`);
  const name = range.replaceAll('/', '_');
  const page = join(directory, `${name}.html`);
  const data = join(directory, `${name}.json`);
  if (values.notes !== undefined) {
    await fillNotes({ range, page, notesFile: values.notes });
    return page;
  }
  const reading = await readRange({ repo, from, to, readers, linkers, onPath });
  reading.skipped.forEach(skip => {
    console.error(notReadLine(skip));
  });
  const review = pageData({ reading, range, version: await ownVersion(), pullRequest });
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
