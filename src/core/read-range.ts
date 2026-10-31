import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, relative } from 'node:path';
import { promisify } from 'node:util';
import { CONFIG_FILE, type Config, parseConfig } from './config.ts';
import { diffGraphs, type FilePatch, type Rename } from './diff-graphs.ts';
import { type Graph, stackOfIn } from './graph.ts';
import type { DanglingCall } from './linker.ts';
import { measuredNodes } from './metrics.ts';
import {
  type Adapters,
  checkConfig,
  type ReaderRoot,
  readStacks,
  type StacksReading,
} from './read-stacks.ts';
import type { FileMeasures, Reader } from './reader.ts';
import type { Skipped } from './skipped.ts';
import { type TestFile, testChanges, withMovedTests } from './test-changes.ts';

const run = promisify(execFile);

export type Churn = Readonly<Record<string, number>>;

export type Measures = Readonly<Record<string, FileMeasures>>;

export type RangeReading = {
  readonly before: Graph;
  readonly after: Graph;
  readonly churn: { readonly before: Churn; readonly after: Churn };
  readonly measures: { readonly before: Measures; readonly after: Measures };
  readonly changedPaths: ReadonlyArray<string>;
  readonly renames: ReadonlyArray<Rename>;
  readonly patches: ReadonlyArray<FilePatch>;
  readonly tests: ReadonlyArray<TestFile>;
  readonly danglingCalls: ReadonlyArray<DanglingCall>;
  readonly skipped: ReadonlyArray<Skipped>;
  readonly thresholds: Omit<Config['metrics'], 'churnDays'>;
};

type ReadRangeOptions = Adapters & {
  readonly repo: string;
  readonly from: string;
  readonly to: string;
  readonly churnTo?: string;
};

const git = async (repo: string, ...args: ReadonlyArray<string>): Promise<string> =>
  (await run('git', ['-C', repo, ...args], { maxBuffer: Number.POSITIVE_INFINITY })).stdout.trim();

type ReadSideOptions = Adapters & {
  readonly repo: string;
  readonly revision: string;
  readonly directory: string;
  readonly config: Config;
};

const readSide = async ({
  repo,
  revision,
  ...options
}: ReadSideOptions): Promise<StacksReading> => {
  await git(repo, 'worktree', 'add', '--detach', options.directory, revision);
  return readStacks({ ...options, repoName: basename(repo) });
};

const skippedAcross = (skips: ReadonlyArray<Skipped>): ReadonlyArray<Skipped> =>
  skips.reduce<ReadonlyArray<Skipped>>((merged, skip) => {
    const known = merged.find(({ reader }) => reader === skip.reader);
    return known === undefined
      ? [...merged, skip]
      : merged.map(each =>
          each === known
            ? { ...each, stacks: [...new Set([...each.stacks, ...skip.stacks])] }
            : each,
        );
  }, []);

const textIn = async (directory: string, path: string): Promise<string | undefined> =>
  existsSync(join(directory, path)) ? readFile(join(directory, path), 'utf8') : undefined;

type TestFileOptions = {
  readonly scratch: string;
  readonly change: Rename;
  readonly reader: Reader;
};

const testFileAt = async ({
  scratch,
  change: { from, to },
  reader,
}: TestFileOptions): Promise<TestFile> => {
  const before = await textIn(join(scratch, 'before'), from);
  const after = await textIn(join(scratch, 'after'), to);
  const renamedFrom = from === to ? undefined : from;
  try {
    return {
      path: to,
      renamedFrom,
      statements: testChanges({ read: reader.readTests, before, after }),
    };
  } catch (error) {
    return { path: to, renamedFrom, unreadable: String(error) };
  }
};

const isUnder = (path: string, root: string): boolean => !relative(root, path).startsWith('..');

type TestsInOptions = {
  readonly scratch: string;
  readonly changes: ReadonlyArray<Rename>;
  readonly roots: ReadonlyArray<ReaderRoot>;
};

const testsIn = async ({
  scratch,
  changes,
  roots,
}: TestsInOptions): Promise<ReadonlyArray<TestFile>> => {
  const files = await Promise.all(
    changes.flatMap(change => {
      const reader = roots.find(
        ({ reader, root }) => reader.isTestFile(change.to) && isUnder(change.to, root),
      )?.reader;
      return reader === undefined ? [] : [testFileAt({ scratch, change, reader })];
    }),
  );
  return files.filter(file => !('statements' in file) || file.statements.length > 0);
};

const configAt = async (repo: string, revision: string): Promise<Config> => {
  if ((await git(repo, 'ls-tree', '--name-only', revision, '--', CONFIG_FILE)) !== '')
    return parseConfig(await git(repo, 'show', `${revision}:${CONFIG_FILE}`));
  return parseConfig((await textIn(repo, CONFIG_FILE)) ?? '{}');
};

type ChurnOptions = {
  readonly repo: string;
  readonly revision: string;
  readonly directory: string;
  readonly graph: Graph;
  readonly days: number;
};

const isFile = (path: string): Promise<boolean> =>
  stat(path).then(
    stats => stats.isFile(),
    () => false,
  );

const churnAt = async ({
  repo,
  revision,
  directory,
  graph,
  days,
}: ChurnOptions): Promise<Churn> => {
  const end = Number(await git(repo, 'log', '-1', '--format=%ct', revision, '--'));
  const since = `--since=@${end - days * 24 * 60 * 60}`;
  const touched = (
    await git(repo, 'log', '-z', '--format=', '--name-only', since, revision, '--')
  ).split('\0');
  const commits = Map.groupBy(touched, path => path);
  const paths = graph.nodes.map(({ path }) => path);
  const areFiles = await Promise.all(paths.map(path => isFile(join(directory, path))));
  const files = paths.filter((_, index) => areFiles[index]);
  return Object.fromEntries(files.map(path => [path, commits.get(path)?.length ?? 0]));
};

type MeasuresOptions = {
  readonly directory: string;
  readonly stacks: StacksReading['stacks'];
  readonly files: ReadonlyArray<{ readonly stack: string; readonly path: string | undefined }>;
};

const measuresAt = async ({ directory, stacks, files }: MeasuresOptions): Promise<Measures> => {
  const measured = await Promise.all(
    files.map(async ({ stack, path }) => {
      const measure = stacks.find(each => each.stack === stack)?.reader.measure;
      if (path === undefined || measure === undefined) return [];
      if (!(await isFile(join(directory, path)))) return [];
      const text = await readFile(join(directory, path), 'utf8');
      try {
        return [[path, measure(text, path)] as const];
      } catch {
        return [];
      }
    }),
  );
  return Object.fromEntries(measured.flat());
};

const resolve = (repo: string, revision: string): Promise<string> =>
  git(repo, 'rev-parse', '--verify', '--quiet', `${revision}^{commit}`).catch(() => {
    throw new Error(`Unknown revision: ${revision}`);
  });

export const readRange = async ({
  repo,
  from,
  to,
  churnTo = to,
  ...adapters
}: ReadRangeOptions): Promise<RangeReading> => {
  const [fromCommit, toCommit] = await Promise.all([resolve(repo, from), resolve(repo, to)]);
  const base = await git(repo, 'merge-base', fromCommit, toCommit);
  const config = await configAt(repo, toCommit);
  const scratch = await realpath(await mkdtemp(join(tmpdir(), 'visual-review-')));
  try {
    const before = await readSide({
      repo,
      revision: base,
      directory: join(scratch, 'before'),
      config,
      ...adapters,
    });
    const after = await readSide({
      repo,
      revision: toCommit,
      directory: join(scratch, 'after'),
      config,
      ...adapters,
    });
    checkConfig(config, [...before.stacks, ...after.stacks], adapters.linkers);
    const changes = (await git(repo, 'diff', '--find-renames', '--name-status', base, toCommit))
      .split('\n')
      .filter(line => line !== '')
      .map(line => line.split('\t').slice(1));
    const changedPaths = changes.flat();
    const renames = changes.flatMap(([from = '', to]) => (to === undefined ? [] : [{ from, to }]));
    const diff = diffGraphs({ before: before.graph, after: after.graph, changedPaths, renames });
    const stackOf = stackOfIn(diff.nodes);
    const measured = measuredNodes({ diff, before: before.graph });
    const measures = {
      before: await measuresAt({
        directory: join(scratch, 'before'),
        stacks: before.stacks,
        files: measured.map(({ id, basePath }) => ({ stack: stackOf(id), path: basePath })),
      }),
      after: await measuresAt({
        directory: join(scratch, 'after'),
        stacks: after.stacks,
        files: measured.map(({ id, headPath }) => ({ stack: stackOf(id), path: headPath })),
      }),
    };
    const { churnDays, ...thresholds } = config.metrics;
    const churn = {
      before: await churnAt({
        repo,
        revision: base,
        directory: join(scratch, 'before'),
        graph: before.graph,
        days: churnDays,
      }),
      after: await churnAt({
        repo,
        revision: churnTo,
        directory: join(scratch, 'after'),
        graph: after.graph,
        days: churnDays,
      }),
    };
    return {
      before: before.graph,
      after: after.graph,
      churn,
      measures,
      danglingCalls: after.danglingCalls,
      skipped: skippedAcross([...before.skipped, ...after.skipped]),
      thresholds,
      changedPaths,
      renames,
      tests: withMovedTests(
        await testsIn({
          scratch,
          changes: changes.map(([from = '', to = from]) => ({ from, to })),
          roots: [...before.roots, ...after.roots],
        }),
      ),
      patches: await Promise.all(
        changes.map(async paths => ({
          path: paths.at(-1) ?? '',
          patch: await git(repo, 'diff', '--find-renames', base, toCommit, '--', ...paths),
        })),
      ),
    };
  } finally {
    await rm(scratch, { recursive: true });
    await git(repo, 'worktree', 'prune');
  }
};
