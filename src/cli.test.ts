import { execFile } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';
import { pullRequestRemote } from './test-support/pull-request-remote.ts';
import {
  axumCrate,
  cargoWorkspace,
  commit,
  crateFiles,
  git,
  pathTo,
  writeFiles,
} from './test-support/repos.ts';

type CliRun = { readonly code: number; readonly stdout: string; readonly stderr: string };

const runCliIn = (
  options: { readonly cwd: string; readonly env?: NodeJS.ProcessEnv },
  ...args: ReadonlyArray<string>
): Promise<CliRun> =>
  promisify(execFile)(
    process.execPath,
    [join(import.meta.dirname, 'cli.ts'), ...args],
    options,
  ).then(
    ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
    (error: { code: number; stdout: string; stderr: string }) => ({
      code: error.code,
      stdout: error.stdout,
      stderr: error.stderr,
    }),
  );

const runCli = (cwd: string, ...args: ReadonlyArray<string>): Promise<CliRun> =>
  runCliIn({ cwd }, ...args);

const slotIn = (html: string, id: string): unknown =>
  JSON.parse(
    new RegExp(`<script type="application/json" id="${id}">([\\s\\S]*?)</script>`).exec(
      html,
    )?.[1] ?? 'null',
  );

const reviewDataIn = (html: string): unknown => slotIn(html, 'review-data');

test('writes the review page for a range into .reviews/, with its calls that match no route, the patches of drawn files apart from the rest, the statements of changed test files, and slashes in revision names made filename-safe', async () => {
  using workspace = cargoWorkspace();
  const { repo } = workspace;
  commit(repo, { 'web/package.json': '{}\n' });
  git(repo, 'switch', '--quiet', '--create', 'feature/cli');
  commit(repo, {
    ...axumCrate('cli'),
    'web/src/a.tsx': "fetch('/api/x');\n",
    'README.md': 'not drawn',
    'web/notes.test.ts': "test('reads notes', () => {});\n",
  });

  const run = await runCli(repo, 'main..feature/cli');

  const page = join(repo, '.reviews', 'main..feature_cli.html');
  expect(run).toMatchObject({ code: 0, stdout: `${page}\n` });
  const reviewData = reviewDataIn(readFileSync(page, 'utf8'));
  expect(reviewData).toMatchObject({
    range: 'main..feature/cli',
    diff: {
      nodes: expect.arrayContaining([
        expect.objectContaining({ id: 'rust/crate/cli', state: 'added' }),
      ]),
    },
    dangling: [{ from: 'web/file/a.tsx', path: '/api/x' }],
    patches: ['crates/cli/Cargo.toml', 'crates/cli/src/lib.rs', 'web/src/a.tsx'].map(path =>
      expect.objectContaining({ path }),
    ),
    undrawn: ['README.md', 'web/notes.test.ts'].map(path => expect.objectContaining({ path })),
    tests: [
      {
        path: 'web/notes.test.ts',
        statements: [{ kind: 'test', name: 'reads notes', change: 'added' }],
      },
    ],
  });
  expect(reviewData).not.toHaveProperty('skipped');
  expect(
    JSON.parse(readFileSync(join(repo, '.reviews', 'main..feature_cli.json'), 'utf8')),
  ).toEqual(reviewData);
}, 60_000);

test('without cargo on PATH, the review still writes its page, says on stderr which stacks were not read, and lists them in its data', async () => {
  using workspace = cargoWorkspace();
  const { repo } = workspace;
  writeFiles(repo, crateFiles('cli'));
  using bin = pathTo('git');

  const run = await runCliIn({ cwd: repo, env: { ...process.env, PATH: bin.path } });

  const page = join(repo, '.reviews', 'HEAD..worktree.html');
  expect(run).toMatchObject({
    code: 0,
    stdout: `${page}\n`,
    stderr: 'rust not read: cargo not found on PATH\n',
  });
  expect(reviewDataIn(readFileSync(page, 'utf8'))).toMatchObject({
    skipped: [{ reader: 'rust', tool: 'cargo', stacks: ['rust'] }],
  });
}, 60_000);

test('with no range, reviews the uncommitted work against HEAD as HEAD..worktree', async () => {
  using workspace = cargoWorkspace();
  const { repo } = workspace;
  writeFiles(repo, crateFiles('cli'));

  const run = await runCli(repo);

  const page = join(repo, '.reviews', 'HEAD..worktree.html');
  expect(run).toMatchObject({ code: 0, stdout: `${page}\n` });
  expect(reviewDataIn(readFileSync(page, 'utf8'))).toMatchObject({
    range: 'HEAD..worktree',
    diff: {
      nodes: expect.arrayContaining([
        expect.objectContaining({ id: 'rust/crate/cli', state: 'added' }),
      ]),
    },
  });
}, 60_000);

test.for([
  {
    missing: 'git',
    tools: [],
    args: [],
    message: 'git not found on PATH: install it from https://git-scm.com/downloads\n',
  },
  {
    missing: 'gh',
    tools: ['git'],
    args: ['16'],
    message: 'gh not found on PATH: install it from https://cli.github.com\n',
  },
])(
  'without $missing on PATH, the review fails saying where to install it',
  async ({ tools, args, message }) => {
    using workspace = cargoWorkspace();
    using bin = pathTo(...tools);

    const run = await runCliIn(
      { cwd: workspace.repo, env: { ...process.env, PATH: bin.path } },
      ...args,
    );

    expect(run).toMatchObject({ code: 1, stderr: message });
  },
);

test('a PR number reviews the PR from its merge base to its head, so its new crate shows as added, and names the page by that sha range', async () => {
  using pr = pullRequestRemote();

  const run = await runCliIn({ cwd: pr.clone, env: { ...process.env, PATH: pr.path } }, '7');

  const range = `${pr.branchPoint}..${pr.head}`;
  const page = join(pr.clone, '.reviews', `${range}.html`);
  expect(run).toMatchObject({ code: 0, stdout: `${page}\n` });
  expect(reviewDataIn(readFileSync(page, 'utf8'))).toMatchObject({
    range,
    pullRequest: { number: 7, title: 'Add the cli crate' },
    diff: {
      nodes: expect.arrayContaining([
        expect.objectContaining({ id: 'rust/crate/cli', state: 'added' }),
      ]),
    },
  });
}, 60_000);

test('git ignores .reviews/ in a repo that does not, so a second review of the uncommitted work leaves the first page out of it', async () => {
  using workspace = cargoWorkspace();
  const { repo } = workspace;
  writeFiles(repo, crateFiles('cli'));
  await runCli(repo);

  const run = await runCli(repo);

  expect(run.code).toBe(0);
  expect(git(repo, 'status', '--porcelain')).not.toContain('.reviews');
}, 60_000);

test.for([
  { mode: 'a review', args: ['main..main'] },
  { mode: 'filling notes', args: ['main..main', '--notes', 'notes.json'] },
])(
  'a .reviews that is a symlink makes $mode exit non-zero, naming it, and leaves what it points at as it was',
  { timeout: 60_000 },
  async ({ args }) => {
    using workspace = cargoWorkspace();
    const { repo } = workspace;
    const elsewhere = join(repo, 'elsewhere');
    writeFiles(repo, { 'elsewhere/.gitignore': 'mine\n' });
    symlinkSync(elsewhere, join(repo, '.reviews'));

    const run = await runCli(repo, ...args);

    expect(run.code).not.toBe(0);
    expect(run.stderr).toContain(`${join(repo, '.reviews')} is not a directory`);
    expect(readdirSync(elsewhere)).toEqual(['.gitignore']);
    expect(readFileSync(join(elsewhere, '.gitignore'), 'utf8')).toBe('mine\n');
  },
);

test('writing a page keeps .reviews/ to the 20 most recently written pages', async () => {
  using workspace = cargoWorkspace();
  const { repo } = workspace;
  const reviews = join(repo, '.reviews');
  mkdirSync(reviews);
  Array.from({ length: 20 }, (_, index) => index).forEach(index => {
    const page = join(reviews, `old-${String(index).padStart(2, '0')}.html`);
    writeFileSync(page, '');
    utimesSync(page, 1_000 + index, 1_000 + index);
  });

  await runCli(repo, 'main..main');

  const pages = readdirSync(reviews).filter(file => file.endsWith('.html'));
  expect(pages).toHaveLength(20);
  expect(pages).toContain('main..main.html');
  expect(pages).not.toContain('old-00.html');
}, 60_000);

test('--notes fills the notes into the page already written for the range, a closing script tag included, without reading the range again', async () => {
  using workspace = cargoWorkspace();
  const { repo } = workspace;
  git(repo, 'switch', '--quiet', '--create', 'feature');
  commit(repo, crateFiles('cli'));
  await runCli(repo, 'main..feature');
  commit(repo, crateFiles('later'));
  const notes = {
    version: 1,
    summary: [{ text: 'Adds a CLI.', target: 'rust/crate/cli' }, { text: 'Nothing else moves.' }],
    tests: 'No test pins the new CLI.',
    notes: { 'rust/crate/cli': { text: 'Ends with </script>.', flag: 'new entry point' } },
  };
  const notesFile = join(repo, 'notes.json');
  writeFileSync(notesFile, JSON.stringify(notes));

  const run = await runCli(repo, 'main..feature', '--notes', notesFile);

  expect(run.code).toBe(0);
  const html = readFileSync(join(repo, '.reviews', 'main..feature.html'), 'utf8');
  expect(slotIn(html, 'review-notes')).toEqual(notes);
  expect(reviewDataIn(html)).not.toMatchObject({
    diff: { nodes: expect.arrayContaining([expect.objectContaining({ id: 'rust/crate/later' })]) },
  });
}, 60_000);

test('--notes before any page for the range exits non-zero saying to run without --notes first', async () => {
  using workspace = cargoWorkspace();
  const notesFile = join(workspace.repo, 'notes.json');
  writeFileSync(notesFile, JSON.stringify({ version: 1, summary: [], tests: '', notes: {} }));

  const run = await runCli(workspace.repo, 'main..main', '--notes', notesFile);

  expect(run.code).not.toBe(0);
  expect(run.stderr).toContain('without --notes first');
}, 60_000);

test('a notes file without a version exits non-zero with the contract error and writes no page', async () => {
  using workspace = cargoWorkspace();
  const notesFile = join(workspace.repo, 'notes.json');
  writeFileSync(notesFile, JSON.stringify({ summary: [], tests: '', notes: {} }));

  const run = await runCli(workspace.repo, 'main..main', '--notes', notesFile);

  expect(run.code).not.toBe(0);
  expect(run.stderr).toContain(
    `Invalid notes file ${notesFile}: no "version"; this visual-review reads version 1`,
  );
  expect(existsSync(join(workspace.repo, '.reviews'))).toBe(false);
}, 60_000);

test('notes that name a part not in the graph, or leave a touched part without a note, exit non-zero listing both and leave the page as it was', async () => {
  using workspace = cargoWorkspace();
  const { repo } = workspace;
  git(repo, 'switch', '--quiet', '--create', 'feature');
  commit(repo, crateFiles('cli'));
  await runCli(repo, 'main..feature');
  const notesFile = join(repo, 'notes.json');
  writeFileSync(
    notesFile,
    JSON.stringify({
      version: 1,
      summary: [],
      tests: '',
      notes: { 'rust/crate/gone': { text: 'Removed.' } },
    }),
  );
  const page = readFileSync(join(repo, '.reviews', 'main..feature.html'), 'utf8');

  const run = await runCli(repo, 'main..feature', '--notes', notesFile);

  expect(run.code).not.toBe(0);
  expect(run.stderr).toContain(notesFile);
  expect(run.stderr).toContain('unknown id rust/crate/gone');
  expect(run.stderr).toContain('no note on rust/crate/cli');
  expect(readFileSync(join(repo, '.reviews', 'main..feature.html'), 'utf8')).toBe(page);
}, 60_000);

test('a revision name that closes a script tag stays inside the review data', async () => {
  using workspace = cargoWorkspace();
  const { repo } = workspace;
  git(repo, 'switch', '--quiet', '--create', 'x<b></script>');
  commit(repo, crateFiles('cli'));

  await runCli(repo, 'main..x<b></script>');

  const html = readFileSync(join(repo, '.reviews', 'main..x<b><_script>.html'), 'utf8');
  expect(reviewDataIn(html)).toMatchObject({ range: 'main..x<b></script>' });
}, 60_000);

test('an unknown revision exits non-zero naming it and writes no page', async () => {
  using workspace = cargoWorkspace();

  const run = await runCli(workspace.repo, 'main..no-such-branch');

  expect(run.code).not.toBe(0);
  expect(run.stderr).toContain('Unknown revision: no-such-branch');
  expect(existsSync(join(workspace.repo, '.reviews'))).toBe(false);
}, 60_000);

test.for([
  { reason: 'text ending in a number', argument: 'v7' },
  { reason: 'a number followed by text', argument: '7a' },
])(
  'an argument that is neither a from..to range nor a PR number, such as $reason, exits non-zero and writes no page',
  { timeout: 60_000 },
  async ({ argument }) => {
    using workspace = cargoWorkspace();

    const run = await runCli(workspace.repo, argument);

    expect(run.code).not.toBe(0);
    expect(run.stderr).toContain('<from>..<to>');
    expect(existsSync(join(workspace.repo, '.reviews'))).toBe(false);
  },
);
