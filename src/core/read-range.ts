import { existsSync } from 'node:fs';
import { mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, relative } from 'node:path';
import type { AccessReader } from './access.ts';
import {
  type BaseConfig,
  CONFIG_FILE,
  type Config,
  type DeployConfig,
  type NotesConfig,
  parseBaseConfig,
  parseConfig,
  type ReaderName,
} from './config.ts';
import { deployKeysIn } from './deploy-findings.ts';
import { diffGraphs, type FilePatch, type GraphDiff, type Rename } from './diff-graphs.ts';
import { readFileThatEnds } from './file-that-ends.ts';
import { git } from './git.ts';
import { type Graph, stackOfIn } from './graph.ts';
import type { DanglingCall } from './linker.ts';
import { dropLinksLeaving, isTrackedLinkLeaving } from './links-leaving.ts';
import type { Lockfile } from './lockfile.ts';
import { type MeasuredNode, measuredNodes } from './metrics.ts';
import type { MigrationReader } from './migration.ts';
import { type AccessReading, readAccess } from './read-access.ts';
import { type DependencyChanges, readLockfiles } from './read-lockfiles.ts';
import { type MigrationReading, readMigrations } from './read-migrations.ts';
import { type Reach, readReaches } from './read-reaches.ts';
import { type RoutesReading, readRoutes } from './read-routes.ts';
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
import type { RouteReader } from './routes.ts';
import { type RuleBreak, ruleBreaks, rulesNotRead } from './rule-breaks.ts';
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
        readonly after: Graph;
        readonly pullRequest: ReviewedDiff;
        readonly commits: ReadonlyArray<Commit>;
      })
  );

export type RangeReading = {
  readonly before: Graph;
  readonly after: Graph;
  readonly churn: { readonly before: Churn; readonly after: Churn };
  readonly measures: { readonly before: Measures; readonly after: Measures };
  readonly measuresNotRead: ReadonlyArray<string>;
  readonly changedPaths: ReadonlyArray<string>;
  readonly renames: ReadonlyArray<Rename>;
  readonly patches: ReadonlyArray<FilePatch>;
  readonly tests: ReadonlyArray<TestFile>;
  readonly symbols: ReadonlyArray<SymbolFile>;
  readonly symbolsNotRead: ReadonlyArray<string>;
  readonly reaches: ReadonlyArray<Reach>;
  readonly reachesNotRead: ReadonlyArray<string>;
  readonly dependencyChanges: ReadonlyArray<DependencyChanges>;
  readonly migrations: ReadonlyArray<MigrationReading>;
  readonly schemas: ReadonlyArray<SchemaReading>;
  readonly routes: ReadonlyArray<RoutesReading>;
  readonly access: ReadonlyArray<AccessReading>;
  readonly openActions: ReadonlyArray<string>;
  readonly danglingCalls: ReadonlyArray<DanglingCall>;
  readonly linksNotRead: ReadonlyArray<string>;
  readonly skipped: ReadonlyArray<Skipped>;
  readonly readers: ReadonlyArray<ReaderName>;
  readonly thresholds: Omit<Config['metrics'], 'churnDays'>;
  readonly churnDays: number;
  readonly ruleBreaks: ReadonlyArray<RuleBreak>;
  readonly rulesNotRead: ReadonlyArray<string>;
  readonly deployKeysAtBase: ReadonlyArray<string>;
  readonly deployConfig: DeployConfig;
  readonly notesConfig: NotesConfig;
  readonly reviewed?: ReviewedReading;
};

type ReadRangeOptions = Adapters & {
  readonly lockfiles: ReadonlyArray<Lockfile>;
  readonly migrations: ReadonlyArray<MigrationReader>;
  readonly schemas: ReadonlyArray<SchemaReader>;
  readonly routes: ReadonlyArray<RouteReader>;
  readonly access: ReadonlyArray<AccessReader>;
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

type KeysNamedAt = {
  readonly repo: string;
  readonly revision: string;
  readonly keys: ReadonlyArray<string>;
};

const noneFound = (error: unknown): string => {
  if (error instanceof Error && 'code' in error && error.code === 1) return '';
  throw error;
};

const keysNamedAt = async ({ repo, revision, keys }: KeysNamedAt) => {
  if (keys.length === 0) return [];
  const named = await git(
    repo,
    'grep',
    '-F',
    '-w',
    '-o',
    '-h',
    '-I',
    '--no-line-number',
    '--no-column',
    ...keys.flatMap(key => ['-e', key]),
    revision,
    '--',
  ).catch(noneFound);
  const found = new Set(named.split('\n'));
  return keys.filter(key => found.has(key));
};

const readSide = async ({
  repo,
  revision,
  ...options
}: ReadSideOptions): Promise<StacksReading> => {
  await git(repo, 'worktree', 'add', '--detach', options.directory, revision);
  await dropLinksLeaving({ repo, revision, directory: options.directory });
  return readStacks({ ...options, repoName: basename(repo) });
};

type SkipsAt = { readonly side: 'base' | 'head'; readonly reading: StacksReading };

type Failure = {
  readonly reader: ReaderName;
  readonly reason: string;
  readonly stack: string;
  readonly side: Skipped['side'];
};

const failuresIn = ({ skipped }: StacksReading) =>
  skipped.flatMap(({ reader, reason, stacks }) => stacks.map(stack => ({ reader, reason, stack })));

const entryOf = ({ reader, reason, side }: Failure): string =>
  JSON.stringify([reader, reason, side ?? null]);

const mergedByReason = (failures: ReadonlyArray<Failure>): ReadonlyArray<Skipped> =>
  [...Map.groupBy(failures, entryOf).values()].flatMap(([first, ...rest]) =>
    first === undefined
      ? []
      : [
          {
            reader: first.reader,
            stacks: [...new Set([first, ...rest].map(({ stack }) => stack))],
            reason: first.reason,
            ...(first.side === undefined ? {} : { side: first.side }),
          },
        ],
  );

const skippedAcross = (sides: ReadonlyArray<SkipsAt>): ReadonlyArray<Skipped> => {
  const failures = sides.flatMap(({ side, reading }) =>
    failuresIn(reading).map(failure => ({ ...failure, side })),
  );
  const drawnAt = (stack: string) =>
    sides.filter(({ reading }) => reading.roots.some(drawn => drawn.stack === stack)).length;
  const failedAt = ({ reader, reason, stack }: Failure) =>
    failures.filter(
      each => each.reader === reader && each.reason === reason && each.stack === stack,
    ).length;
  return mergedByReason(
    failures.map(failure => ({
      ...failure,
      side: failedAt(failure) < drawnAt(failure.stack) ? failure.side : undefined,
    })),
  );
};

const skippedAtReview = (
  readings: ReadonlyArray<StacksReading>,
  notRead: ReadonlySet<string>,
): ReadonlyArray<Skipped> =>
  mergedByReason(
    readings
      .flatMap(failuresIn)
      .filter(({ stack }) => !notRead.has(stack))
      .map(failure => ({ ...failure, side: 'reviewed' })),
  );

const withoutStacks = (reading: StacksReading, stacks: ReadonlySet<string>): StacksReading => {
  const stackOf = stackOfIn(reading.graph.nodes);
  const nodes = reading.graph.nodes.filter(({ id }) => !stacks.has(stackOf(id)));
  const ids = new Set(nodes.map(({ id }) => id));
  const edges = reading.graph.edges.filter(({ from, to }) => ids.has(from) && ids.has(to));
  return { ...reading, graph: { nodes, edges } };
};

const notReadAcross = (...readings: ReadonlyArray<StacksReading>): ReadonlySet<string> =>
  new Set(readings.flatMap(({ skipped }) => skipped.flatMap(({ stacks }) => stacks)));

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
  const inWorkingTree = join(repo, CONFIG_FILE);
  if (!existsSync(inWorkingTree)) return parseConfig('{}');
  if (await isTrackedLinkLeaving(repo, CONFIG_FILE))
    throw new Error(`${CONFIG_FILE}: a tracked link leaving the repo is not read`);
  return parseConfig(await readFileThatEnds(inWorkingTree));
};

const baseConfigAt = async (repo: string, revision: string): Promise<BaseConfig> =>
  parseBaseConfig(
    (await git(repo, 'ls-tree', '--name-only', revision, '--', CONFIG_FILE)) === ''
      ? '{}'
      : await git(repo, 'show', `${revision}:${CONFIG_FILE}`),
  );

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
  readonly notRead: ReadonlySet<string>;
};

const withoutStacksAt = (side: Side, stacks: ReadonlySet<string>): Side => ({
  ...side,
  reading: withoutStacks(side.reading, stacks),
});

type ReviewedSide = {
  readonly reading: ReviewedReading;
  readonly skipped: ReadonlyArray<Skipped>;
};

const reviewedSide = async ({
  reviewed,
  from,
  to,
  base,
  baseSide,
  headSide,
  changedPaths,
  notRead,
  ...side
}: ReviewedSideOptions): Promise<ReviewedSide> => {
  const revision = await resolve(side.repo, reviewed.head).catch(() => undefined);
  if (revision === undefined) return { reading: { ...reviewed, gone: true }, skipped: [] };
  try {
    const read = {
      directory: side.directory,
      reading: await readSide({ ...side, revision }),
    };
    const forkedAt = await git(side.repo, 'merge-base', from, revision);
    const directory = `${side.directory}-fork`;
    const readFork =
      forkedAt === base
        ? baseSide
        : { directory, reading: await readSide({ ...side, revision: forkedAt, directory }) };
    const dropped = new Set([...notRead, ...notReadAcross(read.reading, readFork.reading)]);
    const atReview = withoutStacksAt(read, dropped);
    const fork = withoutStacksAt(readFork, dropped);
    const pullRequest = await changesAcross({
      before: fork,
      after: atReview,
      changes: await changesBetween(side.repo, forkedAt, revision),
    });
    const paths = [...changedPaths, ...pullRequest.changedPaths];
    const changes = await changesBetween(side.repo, revision, to);
    const head = withoutStacksAt(headSide, dropped);
    const reading: ReviewedReading = {
      ...reviewed,
      after: head.reading.graph,
      ...(await changesAcross({
        before: atReview,
        after: head,
        changes: changes.filter(change => change.some(path => paths.includes(path))),
      })),
      ...pathsIn(changes),
      pullRequest,
      commits: await commitsBetween(side.repo, revision, to),
    };
    return { reading, skipped: skippedAtReview([read.reading, readFork.reading], notRead) };
  } catch (error) {
    return { reading: { ...reviewed, unreadable: String(error) }, skipped: [] };
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
  routes,
  access,
  ...adapters
}: ReadRangeOptions): Promise<RangeReading> => {
  const [fromCommit, toCommit] = await Promise.all([resolve(repo, from), resolve(repo, to)]);
  const base = await git(repo, 'merge-base', fromCommit, toCommit);
  const config = await configAt(repo, toCommit);
  const { notes: notesConfig, security, deploy: deployConfig } = await baseConfigAt(repo, base);
  const scratch = await realpath(await mkdtemp(join(tmpdir(), 'visual-review-')));
  try {
    const sides = { before: join(scratch, 'before'), after: join(scratch, 'after') };
    const read = {
      before: await readSide({
        repo,
        revision: base,
        directory: sides.before,
        config,
        ...adapters,
      }),
      after: await readSide({
        repo,
        revision: toCommit,
        directory: sides.after,
        config,
        ...adapters,
      }),
    };
    const notRead = notReadAcross(read.before, read.after);
    const before = withoutStacks(read.before, notRead);
    const after = withoutStacks(read.after, notRead);
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
    const unmeasured = (stack: string): boolean =>
      ![...before.stacks, ...after.stacks].find(each => each.stack === stack)?.reader.measure;
    const measuresNotRead = [...new Set(measured.map(({ id }) => stackOf(id)))].filter(unmeasured);
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
    const atReview =
      reviewed === undefined
        ? undefined
        : await reviewedSide({
            repo,
            reviewed,
            from: fromCommit,
            to: toCommit,
            base,
            baseSide,
            headSide,
            changedPaths,
            notRead,
            directory: join(scratch, 'reviewed'),
            config,
            ...adapters,
          });
    const routesRead = await readRoutes({ repo, base, head: toCommit, changes, routes });
    const patches = await Promise.all(
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
    );
    return {
      before: before.graph,
      after: after.graph,
      churn,
      measures,
      measuresNotRead,
      ...anchors,
      ...(await readReaches({
        sides,
        before,
        after,
        symbols: anchors.symbols,
        measured,
        changedPaths,
        pathOf: id => diff.nodes.find(node => node.id === id)?.path ?? id,
      })),
      dependencyChanges: await readLockfiles({ repo, base, head: toCommit, changes, lockfiles }),
      migrations: await readMigrations({ repo, base, head: toCommit, changes, migrations }),
      schemas: await readSchemas({ repo, base, head: toCommit, changes, schemas }),
      routes: routesRead,
      access: await readAccess({
        repo,
        base,
        head: toCommit,
        changes,
        routed: routesRead.length > 0,
        access,
        authorize: security.authorize,
      }),
      openActions: security.open,
      danglingCalls: after.danglingCalls,
      linksNotRead: after.linksNotRead,
      skipped: [
        ...skippedAcross([
          { side: 'base', reading: before },
          { side: 'head', reading: after },
        ]),
        ...(atReview?.skipped ?? []),
      ],
      readers: [...new Set([...before.stacks, ...after.stacks].map(({ reader }) => reader.name))],
      thresholds,
      churnDays,
      ruleBreaks: ruleBreaks({ rules: config.rules, graph: after.graph }),
      rulesNotRead: rulesNotRead({ rules: config.rules, graph: after.graph }),
      deployKeysAtBase: await keysNamedAt({ repo, revision: base, keys: deployKeysIn(patches) }),
      deployConfig,
      notesConfig,
      changedPaths,
      renames,
      patches,
      ...(atReview === undefined ? {} : { reviewed: atReview.reading }),
    };
  } finally {
    await rm(scratch, { recursive: true });
    await git(repo, 'worktree', 'prune');
  }
};
