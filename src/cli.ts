#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { lstat, mkdir, readFile } from 'node:fs/promises';
import { findPackageJSON } from 'node:module';
import { basename, join } from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { z } from 'zod';
import { readFileThatEnds } from './core/file-that-ends.ts';
import { parseNotes } from './core/notes.ts';
import {
  notedPageHtml,
  type PageData,
  type PullRequest,
  pageData,
  pageHtml,
  UNCOMMITTED,
} from './core/page.ts';
import { readRange } from './core/read-range.ts';
import { notReadLine } from './core/skipped.ts';
import { lastReviewOf, reviewsDirectoryOf } from './git/last-review.ts';
import { onPath } from './git/on-path.ts';
import { pruneReviews } from './git/prune-reviews.ts';
import { readPullRequest } from './git/pull-request.ts';
import { snapshotWorkingTree } from './git/working-tree.ts';
import { msFrom } from './ms-from.ts';
import { servePage } from './serve.ts';
import { writeAnew } from './write-anew.ts';

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
  readonly churnTo?: string;
  readonly repository?: string;
  readonly pullRequest?: PullRequest;
};

const rangeOf = async (repo: string, argument: string | undefined): Promise<ReviewedRange> => {
  if (argument === undefined) {
    const to = await snapshotWorkingTree(repo);
    return { range: UNCOMMITTED, from: 'HEAD', to, churnTo: 'HEAD' };
  }
  if (/^\d+$/.test(argument)) {
    requireOnPath('gh', 'https://cli.github.com');
    const { from, to, repository, ...pullRequest } = await readPullRequest({
      repo,
      number: Number(argument),
    });
    return { range: `${from}..${to}`, from, to, repository, pullRequest };
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

const PARSERS = ['@babel/parser', 'tree-sitter-ruby', 'tree-sitter-rust', 'web-tree-sitter'];

const parserVersions = async (): Promise<Readonly<Record<string, string>>> => {
  const versions = await Promise.all(
    PARSERS.map(async name => {
      const path = findPackageJSON(name, import.meta.url);
      if (path === undefined) throw new Error(`No package.json for ${name}`);
      return [name, PackageSchema.parse(JSON.parse(await readFile(path, 'utf8'))).version] as const;
    }),
  );
  return Object.fromEntries(versions);
};

type FillNotesOptions = {
  readonly range: string;
  readonly page: string;
  readonly notesFile: string;
};

const fillNotes = async ({ range, page, notesFile }: FillNotesOptions): Promise<void> => {
  const notes = parseNotes({ text: await readFile(notesFile, 'utf8'), file: notesFile });
  const written = await readFileThatEnds(page).catch(() => {
    throw new Error(`No page for ${range} yet: run visual-review without --notes first`);
  });
  await writeAnew({
    path: page,
    content: notedPageHtml({ page: written, notes, notesFile, version: await ownVersion() }),
  });
};

const repoRoot = async (): Promise<string> => {
  const { stdout } = await promisify(execFile)('git', [
    '-c',
    'safe.bareRepository=explicit',
    'rev-parse',
    '--show-toplevel',
  ]);
  const repo = stdout.trim();
  const dotGit = await lstat(join(repo, '.git')).catch(() => undefined);
  if (dotGit === undefined) throw new Error(`${repo} has no .git, so it is not reviewed`);
  return repo;
};

const writeReview = async (args: ReadonlyArray<string>): Promise<string> => {
  const { positionals, values } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: { notes: { type: 'string' } },
  });
  requireOnPath('git', 'https://git-scm.com/downloads');
  const repo = await repoRoot();
  const {
    range,
    pullRequest,
    repository = basename(repo),
    ...revisions
  } = await rangeOf(repo, positionals[0]);
  const directory = reviewsDirectoryOf(repo);
  if (!(await isDirectoryOrMissing(directory)))
    throw new Error(`${directory} is not a directory, so no page is written into it`);
  const name = range.replaceAll('/', '_');
  const page = join(directory, `${name}.html`);
  const data = join(directory, `${name}.json`);
  if (values.notes !== undefined) {
    await fillNotes({ range, page, notesFile: values.notes });
    return page;
  }
  const { access, linkers, lockfiles, migrations, readers, routes, schemas } = await import(
    './adapters.ts'
  );
  const reviewed =
    pullRequest &&
    (await lastReviewOf({ repo, pullRequest: pullRequest.number, head: revisions.to }));
  const reading = await readRange({
    repo,
    ...revisions,
    ...(reviewed && { reviewed }),
    readers,
    linkers,
    lockfiles,
    migrations,
    schemas,
    routes,
    access,
    onPath,
  });
  reading.skipped.forEach(skip => {
    console.error(notReadLine(skip));
  });
  const review = pageData({
    reading,
    repo: repository,
    range,
    version: await ownVersion(),
    parsers: await parserVersions(),
    pullRequest,
  });
  await mkdir(directory, { recursive: true });
  await writeAnew({ path: join(directory, '.gitignore'), content: '*\n' });
  await writeAnew({ path: data, content: JSON.stringify(review) });
  await writeAnew({ path: page, content: await viewerWith(review) });
  await pruneReviews({ repo, keep: 20 });
  return page;
};

const run = (args: ReadonlyArray<string>): Promise<string | undefined> =>
  args[0] === 'serve'
    ? ownVersion().then(version =>
        servePage({
          page: args.slice(1).find(arg => arg !== '--no-open'),
          version,
          idleMs: msFrom({ variable: 'VISUAL_REVIEW_IDLE_MS', fallback: 10 * 60 * 1000 }),
          firstPingMs: msFrom({
            variable: 'VISUAL_REVIEW_FIRST_PING_MS',
            fallback: 24 * 60 * 60 * 1000,
          }),
          open: !args.includes('--no-open'),
        }),
      )
    : writeReview(args);

run(process.argv.slice(2)).then(
  written => {
    if (written !== undefined) console.log(written);
  },
  (error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
  },
);
