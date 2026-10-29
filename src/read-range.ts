import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, relative } from 'node:path';
import { promisify } from 'node:util';
import { CONFIG_FILE, type Config, checkConfig, configuredNodes, parseConfig } from './config.ts';
import { type Graph, stackOfIn } from './graph.ts';
import type { DanglingCall, Linker } from './linker.ts';
import { fetchAxumLinker } from './linkers/fetch-axum.ts';
import { onPath } from './on-path.ts';
import type { OpenedCheckout, Reader } from './reader.ts';
import { railsReader } from './readers/rails.ts';
import { rustReader } from './readers/rust/reader.ts';
import { typeScriptReader } from './readers/typescript.ts';
import type { Skipped } from './skipped.ts';
import { type TestFile, testChanges, withMovedTests } from './test-statements.ts';

const run = promisify(execFile);

export type FilePatch = {
  readonly path: string;
  readonly patch: string;
};

export type Rename = {
  readonly from: string;
  readonly to: string;
};

export type RangeReading = {
  readonly before: Graph;
  readonly after: Graph;
  readonly changedPaths: ReadonlyArray<string>;
  readonly renames: ReadonlyArray<Rename>;
  readonly patches: ReadonlyArray<FilePatch>;
  readonly tests: ReadonlyArray<TestFile>;
  readonly danglingCalls: ReadonlyArray<DanglingCall>;
  readonly skipped: ReadonlyArray<Skipped>;
};

type ReadRangeOptions = {
  readonly repo: string;
  readonly from: string;
  readonly to: string;
};

const git = async (repo: string, ...args: ReadonlyArray<string>): Promise<string> =>
  (await run('git', ['-C', repo, ...args])).stdout.trim();

const readers: ReadonlyArray<Reader> = [rustReader, typeScriptReader, railsReader];

const linkers: ReadonlyArray<Linker> = [fetchAxumLinker];

type ReaderRoot = {
  readonly reader: Reader;
  readonly root: string;
};

type SideReading = {
  readonly graph: Graph;
  readonly danglingCalls: ReadonlyArray<DanglingCall>;
  readonly roots: ReadonlyArray<ReaderRoot>;
  readonly stacks: ReadonlyArray<DrawnStack>;
  readonly skipped: ReadonlyArray<Skipped>;
};

type DrawnStack = {
  readonly stack: string;
  readonly reader: Reader;
};

type OpenedReader = {
  readonly reader: Reader;
  readonly checkout: OpenedCheckout;
};

type ReadSideOptions = {
  readonly repo: string;
  readonly revision: string;
  readonly directory: string;
  readonly config: Config;
};

const missingToolOf = ({ tool }: Reader): string | undefined =>
  tool === undefined || onPath(tool) ? undefined : tool;

const readSide = async ({
  repo,
  revision,
  directory,
  config,
}: ReadSideOptions): Promise<SideReading> => {
  await git(repo, 'worktree', 'add', '--detach', directory, revision);
  const { opened } = readers.reduce<{
    readonly taken: ReadonlySet<string>;
    readonly opened: ReadonlyArray<OpenedReader>;
  }>(
    (sofar, reader) => {
      const checkout = reader.open({
        directory,
        repoName: basename(repo),
        config,
        taken: sofar.taken,
      });
      return {
        taken: new Set([...sofar.taken, ...checkout.stacks.values()]),
        opened: [...sofar.opened, { reader, checkout }],
      };
    },
    { taken: new Set(), opened: [] },
  );
  const kept = (stack: string): boolean => config.stacks[stack] !== false;
  const skipped = opened.flatMap(({ reader, checkout }) => {
    const tool = missingToolOf(reader);
    const stacks = [...checkout.stacks.values()].filter(kept);
    return tool === undefined || stacks.length === 0 ? [] : [{ reader: reader.name, tool, stacks }];
  });
  const graphs = (
    await Promise.all(
      opened
        .filter(({ reader }) => !skipped.some(({ reader: name }) => name === reader.name))
        .map(({ checkout }) =>
          Promise.all(
            [...checkout.stacks]
              .filter(([, stack]) => kept(stack))
              .map(([root]) => checkout.graph(root)),
          ),
        ),
    )
  ).flat();
  const stacks = opened.flatMap(({ reader, checkout }) =>
    [...checkout.stacks].map(([root, stack]) => ({ stack, reader, root })),
  );
  const nodes = configuredNodes(
    config,
    graphs.flatMap(graph => graph.nodes),
  );
  const roots = stacks.filter(({ stack }) => kept(stack));
  const stackOf = stackOfIn(nodes);
  const linkedBy = (reader: Reader['name'], only: ReadonlyArray<string> | undefined) =>
    roots
      .filter(drawn => drawn.reader.name === reader && (only?.includes(drawn.stack) ?? true))
      .map(({ stack }) => ({ stack, nodes: nodes.filter(({ id }) => stackOf(id) === stack) }));
  const links = await Promise.all(
    linkers.flatMap(linker => {
      const settings = config.linkers[linker.name] ?? {};
      if (settings === false) return [];
      return [
        linker.link({
          directory,
          from: linkedBy(linker.from, settings.from),
          to: linkedBy(linker.to, settings.to),
        }),
      ];
    }),
  );
  const ids = new Set(nodes.map(({ id }) => id));
  const edges = [...graphs.flatMap(graph => graph.edges), ...links.flatMap(({ edges }) => edges)];
  return {
    graph: { nodes, edges: edges.filter(edge => ids.has(edge.from) && ids.has(edge.to)) },
    danglingCalls: links.flatMap(({ dangling }) => dangling),
    roots,
    stacks,
    skipped,
  };
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

const resolve = (repo: string, revision: string): Promise<string> =>
  git(repo, 'rev-parse', '--verify', '--quiet', `${revision}^{commit}`).catch(() => {
    throw new Error(`Unknown revision: ${revision}`);
  });

export const readRange = async ({ repo, from, to }: ReadRangeOptions): Promise<RangeReading> => {
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
    });
    const after = await readSide({
      repo,
      revision: toCommit,
      directory: join(scratch, 'after'),
      config,
    });
    checkConfig(config, [...before.stacks, ...after.stacks], linkers);
    const changes = (await git(repo, 'diff', '--find-renames', '--name-status', base, toCommit))
      .split('\n')
      .filter(line => line !== '')
      .map(line => line.split('\t').slice(1));
    return {
      before: before.graph,
      after: after.graph,
      danglingCalls: after.danglingCalls,
      skipped: skippedAcross([...before.skipped, ...after.skipped]),
      changedPaths: changes.flat(),
      renames: changes.flatMap(([from = '', to]) => (to === undefined ? [] : [{ from, to }])),
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
