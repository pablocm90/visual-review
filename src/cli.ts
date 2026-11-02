#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { findPackageJSON } from 'node:module';
import { basename, join } from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { z } from 'zod';
import { linkers, readers } from './adapters.ts';
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
import { onPath } from './git/on-path.ts';
import { pruneReviews } from './git/prune-reviews.ts';
import { readPullRequest } from './git/pull-request.ts';
import { snapshotWorkingTree } from './git/working-tree.ts';
import { servePage } from './serve.ts';

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
      if (path === undefined) return [];
      return [[name, PackageSchema.parse(JSON.parse(await readFile(path, 'utf8'))).version]];
    }),
  );
  return Object.fromEntries(versions.flat());
};

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
  const {
    range,
    pullRequest,
    repository = basename(repo),
    ...revisions
  } = await rangeOf(repo, positionals[0]);
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
  const reading = await readRange({ repo, ...revisions, readers, linkers, onPath });
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
  await writeFile(join(directory, '.gitignore'), '*\n');
  await writeFile(data, JSON.stringify(review));
  await writeFile(page, await viewerWith(review));
  await pruneReviews({ directory, keep: 20 });
  return page;
};

const MsSchema = z.coerce.number().int().min(1).max(2_147_483_647);

type MsFromOptions = {
  readonly variable: string;
  readonly fallback: number;
};

const msFrom = ({ variable, fallback }: MsFromOptions): number => {
  const written = process.env[variable];
  if (written === undefined) return fallback;
  const parsed = MsSchema.safeParse(written);
  if (!parsed.success)
    throw new Error(
      `${variable} must be a whole number of milliseconds from 1 to 2147483647, not ${JSON.stringify(written)}`,
    );
  return parsed.data;
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
