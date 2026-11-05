import { existsSync } from 'node:fs';
import { mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, relative } from 'node:path';
import { CONFIG_FILE, type Config, parseConfig } from './config.ts';
import { diffGraphs, type FilePatch, type GraphDiff, type Rename } from './diff-graphs.ts';
import { git } from './git.ts';
import { type Graph, stackOfIn } from './graph.ts';
import type { DanglingCall } from './linker.ts';
import type { Lockfile } from './lockfile.ts';
import { type MeasuredNode, measuredNodes } from './metrics.ts';
import type { MigrationReader } from './migration.ts';
import { type DependencyChanges, readLockfiles } from './read-lockfiles.ts';
import { type MigrationReading, readMigrations } from './read-migrations.ts';
import { readSchemas, type SchemaReading } from './read-schemas.ts';
import {
  type Adapters,
  checkConfig,
  type DrawnStack,
  readStacks,
  type StacksReading,
} from './read-stacks.ts';
import type { FileMeasures, FileSymbols, Reader } from './reader.ts';
import type { Review } from './review.ts';
import type { SchemaReader } from './schema.ts';
import type { Skipped } from './skipped.ts';
import { type FileSymbolChanges, symbolChangesOf } from './symbol-changes.ts';
import { type TestFile, testChanges, withMovedTests } from './test-changes.ts';

export type Churn = Readonly<Record<string, number>>;

export type Measures = Readonly<Record<string, FileMeasures>>;

export type SymbolFile = { readonly stack: string } & (
  | FileSymbolChanges
  | { readonly node: string; readonly unreadable: string }
);

export type ReviewedHead = {
  readonly head: string;
  readonly verdict: Review['verdict'];
  readonly body?: string;
  readonly read: ReadonlyArray<string>;
  readonly comments: Review['comments'];
  readonly calledFine: ReadonlyArray<string>;
};

export type ReviewedDiff = {
  readonly before: Graph;
  readonly changedPaths: ReadonlyArray<string>;
  readonly renames: ReadonlyArray<Rename>;
  readonly symbols: ReadonlyArray<SymbolFile>;
  readonly tests: ReadonlyArray<TestFile>;
};

export type Commit = {
  readonly sha: string;
  readonly subject: string;
  readonly files: ReadonlyArray<string>;
};

export type ReviewedReading = ReviewedHead &
  (
    | { readonly gone: true }
    | { readonly unreadable: string }
    | (ReviewedDiff & {
        readonly pullRequest: ReviewedDiff;
        readonly commits: ReadonlyArray<Commit>;
      })
  );

export type RangeReading = {
  readonly before: Graph;
  readonly after: Graph;
  readonly churn: { readonly before: Churn; readonly after: Churn };
  readonly measures: { readonly before: Measures; readonly after: Measures };
  readonly changedPaths: ReadonlyArray<string>;
  readonly renames: ReadonlyArray<Rename>;
  readonly patches: ReadonlyArray<FilePatch>;
  readonly tests: ReadonlyArray<TestFile>;
  readonly symbols: ReadonlyArray<SymbolFile>;
  readonly symbolsNotRead: ReadonlyArray<string>;
  readonly dependencyChanges: ReadonlyArray<DependencyChanges>;
  readonly migrations: ReadonlyArray<MigrationReading>;
  readonly schemas: ReadonlyArray<SchemaReading>;
  readonly danglingCalls: ReadonlyArray<DanglingCall>;
  readonly skipped: ReadonlyArray<Skipped>;
  readonly thresholds: Omit<Config['metrics'], 'churnDays'>;
  readonly churnDays: number;
  readonly reviewed?: ReviewedReading;
};

type ReadRangeOptions = Adapters & {
  readonly lockfiles: ReadonlyArray<Lockfile>;
  readonly migrations: ReadonlyArray<MigrationReader>;
  readonly schemas: ReadonlyArray<SchemaReader>;
  readonly repo: string;
  readonly from: string;
  readonly to: string;
  readonly churnTo?: string;
  readonly reviewed?: ReviewedHead;
};

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

type SideDirectories = {
  readonly before: string;
  readonly after: string;
};

type TestFileOptions = {
  readonly sides: SideDirectories;
  readonly change: Rename;
  readonly reader: Reader;
  readonly stack: string;
};

const testFileAt = async ({
  sides,
  change: { from, to },
  reader,
  stack,
}: TestFileOptions): Promise<TestFile> => {
  const before = await textIn(sides.before, from);
  const after = await textIn(sides.after, to);
  const file = {
    path: to,
    renamedFrom: from === to ? undefined : from,
    ...(before === undefined && { new: true as const }),
    stack,
  };
  try {
    return { ...file, statements: testChanges({ read: reader.readTests, before, after }) };
  } catch (error) {
    return { ...file, unreadable: String(error) };
  }
};

const isUnder = (path: string, root: string): boolean => !relative(root, path).startsWith('..');

const depth = (root: string): number => (root === '.' ? 0 : root.split('/').length);

type TestsInOptions = {
  readonly sides: SideDirectories;
  readonly changes: ReadonlyArray<Rename>;
  readonly roots: ReadonlyArray<DrawnStack>;
};

const testsIn = async ({
  sides,
  changes,
  roots,
}: TestsInOptions): Promise<ReadonlyArray<TestFile>> => {
  const files = await Promise.all(
    changes.flatMap(change => {
      const drawn = roots
        .filter(({ reader, root }) => reader.isTestFile(change.to) && isUnder(change.to, root))
        .toSorted((a, b) => depth(b.root) - depth(a.root))[0];
      return drawn === undefined
        ? []
        : [testFileAt({ sides, change, reader: drawn.reader, stack: drawn.stack })];
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
        const measures = measure(text, path);
        return measures === undefined ? [] : [[path, measures] as const];
      } catch {
        return [];
      }
    }),
  );
  return Object.fromEntries(measured.flat());
};

const NO_SYMBOLS: FileSymbols = { symbols: [], exports: [], astHash: '' };

type SymbolsOptions = {
  readonly directory: string;
  readonly read: NonNullable<Reader['symbols']>;
  readonly path: string | undefined;
};

const symbolsAt = async ({
  directory,
  read,
  path,
}: SymbolsOptions): Promise<FileSymbols | undefined> => {
  if (path === undefined || !(await isFile(join(directory, path)))) return undefined;
  return read(await readFile(join(directory, path), 'utf8'), path);
};

type SymbolsInOptions = {
  readonly sides: SideDirectories;
  readonly files: ReadonlyArray<MeasuredNode>;
  readonly stacks: StacksReading['stacks'];
  readonly stackOf: (id: string) => string;
};

const symbolsIn = async ({
  sides: directories,
  files,
  stacks,
  stackOf,
}: SymbolsInOptions): Promise<Pick<RangeReading, 'symbols' | 'symbolsNotRead'>> => {
  const symbolsReaderOf = (stack: string) =>
    stacks.find(each => each.stack === stack)?.reader.symbols;
  const sidedFiles = await Promise.all(
    files.map(async ({ id, basePath, headPath }) => {
      const read = symbolsReaderOf(stackOf(id));
      if (read === undefined) return [];
      const sides = await Promise.all([
        symbolsAt({ directory: directories.before, read, path: basePath }),
        symbolsAt({ directory: directories.after, read, path: headPath }),
      ]).then(
        ([before, after]) => ({ before, after }),
        error => ({ unreadable: String(error) }),
      );
      if ('unreadable' in sides) return [{ node: id, ...sides }];
      if (sides.before === undefined && sides.after === undefined) return [];
      return [{ node: id, before: sides.before ?? NO_SYMBOLS, after: sides.after ?? NO_SYMBOLS }];
    }),
  );
  const read = sidedFiles.flat();
  return {
    symbols: [
      ...symbolChangesOf(read.filter(file => 'before' in file)),
      ...read.filter(file => 'unreadable' in file),
    ].map(file => ({ ...file, stack: stackOf(file.node) })),
    symbolsNotRead: [
      ...new Set(files.map(({ id }) => stackOf(id)).filter(stack => !symbolsReaderOf(stack))),
    ],
  };
};

export const resolve = (repo: string, revision: string): Promise<string> =>
  git(repo, 'rev-parse', '--verify', '--quiet', `${revision}^{commit}`).catch(() => {
    throw new Error(`Unknown revision: ${revision}`);
  });

const NAME_STATUS_ENTRY = /[RC]\d*\0([^\0]+)\0([^\0]+)\0|[A-Z]\0([^\0]+)\0/gy;

const changesBetween = async (
  repo: string,
  from: string,
  to: string,
): Promise<ReadonlyArray<ReadonlyArray<string>>> =>
  [
    ...(await git(repo, 'diff', '--find-renames', '--name-status', '-z', from, to)).matchAll(
      NAME_STATUS_ENTRY,
    ),
  ].map(([, ...names]) => names.filter(name => name !== undefined));

const commitOf = (record: string): Commit => {
  const [header = '', ...files] = record.replace('\0\n', '\0').split('\0');
  return {
    sha: header.slice(0, header.indexOf(' ')),
    subject: header.slice(header.indexOf(' ') + 1),
    files: files.filter(file => file !== ''),
  };
};

const commitsBetween = async (
  repo: string,
  from: string,
  to: string,
): Promise<ReadonlyArray<Commit>> => {
  const log = await git(
    repo,
    'log',
    '-z',
    '--no-renames',
    '--name-only',
    '--format=%x00%H %s',
    `${from}..${to}`,
  );
  return log === '' ? [] : log.slice(1).split('\0\0').map(commitOf);
};

const pathsIn = (changes: ReadonlyArray<ReadonlyArray<string>>) => ({
  changedPaths: changes.flat(),
  renames: changes.flatMap(([from = '', to]) => (to === undefined ? [] : [{ from, to }])),
});

type Side = {
  readonly directory: string;
  readonly reading: StacksReading;
};

type ChangesAcrossOptions = {
  readonly before: Side;
  readonly after: Side;
  readonly changes: ReadonlyArray<ReadonlyArray<string>>;
};

type AnchorsAcrossOptions = ChangesAcrossOptions & {
  readonly diff: GraphDiff;
  readonly measured: ReadonlyArray<MeasuredNode>;
};

const anchorsAcross = async ({
  before,
  after,
  diff,
  measured,
  changes,
}: AnchorsAcrossOptions): Promise<Pick<RangeReading, 'symbols' | 'symbolsNotRead' | 'tests'>> => {
  const changed = new Set(changes.flat());
  const sides = { before: before.directory, after: after.directory };
  return {
    ...(await symbolsIn({
      sides,
      files: measured.filter(({ headPath }) => changed.has(headPath)),
      stacks: [...before.reading.stacks, ...after.reading.stacks],
      stackOf: stackOfIn(diff.nodes),
    })),
    tests: withMovedTests(
      await testsIn({
        sides,
        changes: changes.map(([from = '', to = from]) => ({ from, to })),
        roots: [...before.reading.roots, ...after.reading.roots],
      }),
    ),
  };
};

const changesAcross = async ({
  before,
  after,
  changes,
}: ChangesAcrossOptions): Promise<ReviewedDiff> => {
  const paths = pathsIn(changes);
  const diff = diffGraphs({ before: before.reading.graph, after: after.reading.graph, ...paths });
  const { symbols, tests } = await anchorsAcross({
    before,
    after,
    diff,
    measured: measuredNodes({ diff, before: before.reading.graph }),
    changes,
  });
  return { before: before.reading.graph, ...paths, symbols, tests };
};

type ReviewedSideOptions = Omit<ReadSideOptions, 'revision' | 'directory'> & {
  readonly reviewed: ReviewedHead;
  readonly from: string;
  readonly to: string;
  readonly base: string;
  readonly baseSide: Side;
  readonly headSide: Side;
  readonly directory: string;
  readonly changedPaths: ReadonlyArray<string>;
};

const reviewedSide = async ({
  reviewed,
  from,
  to,
  base,
  baseSide,
  headSide,
  changedPaths,
  ...side
}: ReviewedSideOptions): Promise<ReviewedReading> => {
  const revision = await resolve(side.repo, reviewed.head).catch(() => undefined);
  if (revision === undefined) return { ...reviewed, gone: true };
  try {
    const atReview = {
      directory: side.directory,
      reading: await readSide({ ...side, revision }),
    };
    const forkedAt = await git(side.repo, 'merge-base', from, revision);
    const directory = `${side.directory}-fork`;
    const fork =
      forkedAt === base
        ? baseSide
        : { directory, reading: await readSide({ ...side, revision: forkedAt, directory }) };
    const pullRequest = await changesAcross({
      before: fork,
      after: atReview,
      changes: await changesBetween(side.repo, forkedAt, revision),
    });
    const paths = [...changedPaths, ...pullRequest.changedPaths];
    const changes = await changesBetween(side.repo, revision, to);
    return {
      ...reviewed,
      ...(await changesAcross({
        before: atReview,
        after: headSide,
        changes: changes.filter(change => change.some(path => paths.includes(path))),
      })),
      ...pathsIn(changes),
      pullRequest,
      commits: await commitsBetween(side.repo, revision, to),
    };
  } catch (error) {
    return { ...reviewed, unreadable: String(error) };
  }
};

export const readRange = async ({
  repo,
  from,
  to,
  churnTo = to,
  reviewed,
  lockfiles,
  migrations,
  schemas,
  ...adapters
}: ReadRangeOptions): Promise<RangeReading> => {
  const [fromCommit, toCommit] = await Promise.all([resolve(repo, from), resolve(repo, to)]);
  const base = await git(repo, 'merge-base', fromCommit, toCommit);
  const config = await configAt(repo, toCommit);
  const scratch = await realpath(await mkdtemp(join(tmpdir(), 'visual-review-')));
  try {
    const sides = { before: join(scratch, 'before'), after: join(scratch, 'after') };
    const before = await readSide({
      repo,
      revision: base,
      directory: sides.before,
      config,
      ...adapters,
    });
    const after = await readSide({
      repo,
      revision: toCommit,
      directory: sides.after,
      config,
      ...adapters,
    });
    checkConfig(config, [...before.stacks, ...after.stacks], adapters.linkers);
    const changes = await changesBetween(repo, base, toCommit);
    const { changedPaths, renames } = pathsIn(changes);
    const diff = diffGraphs({ before: before.graph, after: after.graph, changedPaths, renames });
    const stackOf = stackOfIn(diff.nodes);
    const measured = measuredNodes({ diff, before: before.graph });
    const measures = {
      before: await measuresAt({
        directory: sides.before,
        stacks: before.stacks,
        files: measured.map(({ id, basePath }) => ({ stack: stackOf(id), path: basePath })),
      }),
      after: await measuresAt({
        directory: sides.after,
        stacks: after.stacks,
        files: measured.map(({ id, headPath }) => ({ stack: stackOf(id), path: headPath })),
      }),
    };
    const baseSide = { directory: sides.before, reading: before };
    const headSide = { directory: sides.after, reading: after };
    const anchors = await anchorsAcross({
      before: baseSide,
      after: headSide,
      diff,
      measured,
      changes,
    });
    const { churnDays, ...thresholds } = config.metrics;
    const churn = {
      before: await churnAt({
        repo,
        revision: base,
        directory: sides.before,
        graph: before.graph,
        days: churnDays,
      }),
      after: await churnAt({
        repo,
        revision: churnTo,
        directory: sides.after,
        graph: after.graph,
        days: churnDays,
      }),
    };
    return {
      before: before.graph,
      after: after.graph,
      churn,
      measures,
      ...anchors,
      dependencyChanges: await readLockfiles({ repo, base, head: toCommit, changes, lockfiles }),
      migrations: await readMigrations({ repo, base, head: toCommit, changes, migrations }),
      schemas: await readSchemas({ repo, base, head: toCommit, changes, schemas }),
      danglingCalls: after.danglingCalls,
      skipped: skippedAcross([...before.skipped, ...after.skipped]),
      thresholds,
      churnDays,
      changedPaths,
      renames,
      patches: await Promise.all(
        changes.map(async paths => ({
          path: paths.at(-1) ?? '',
          patch: await git(
            repo,
            '--literal-pathspecs',
            'diff',
            '--find-renames',
            base,
            toCommit,
            '--',
            ...paths,
          ),
        })),
      ),
      ...(reviewed === undefined
        ? {}
        : {
            reviewed: await reviewedSide({
              repo,
              reviewed,
              from: fromCommit,
              to: toCommit,
              base,
              baseSide,
              headSide,
              changedPaths,
              directory: join(scratch, 'reviewed'),
              config,
              ...adapters,
            }),
          }),
    };
  } finally {
    await rm(scratch, { recursive: true });
    await git(repo, 'worktree', 'prune');
  }
};
