import { execFile, execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';
import { pageIn } from './core/page.ts';
import { pullRequestRemote } from './test-support/pull-request-remote.ts';
import {
  axumCrate,
  cargoWorkspace,
  commit,
  crateFiles,
  git,
  gitRepo,
  layOutBareRepository,
  pathTo,
  writeFiles,
} from './test-support/repos.ts';

type CliRun = { readonly code: number; readonly stdout: string; readonly stderr: string };

const ranToTheEnd = ({ stdout, stderr }: { readonly stdout: string; readonly stderr: string }) => ({
  code: 0,
  stdout,
  stderr,
});

const stoppedShort = (error: { code: number; stdout: string; stderr: string }): CliRun => ({
  code: error.code,
  stdout: error.stdout,
  stderr: error.stderr,
});

const runCliIn = (
  options: { readonly cwd: string; readonly env?: NodeJS.ProcessEnv },
  ...args: ReadonlyArray<string>
): Promise<CliRun> =>
  promisify(execFile)(
    process.execPath,
    [join(import.meta.dirname, 'cli.ts'), ...args],
    options,
  ).then(ranToTheEnd, stoppedShort);

const runCli = (cwd: string, ...args: ReadonlyArray<string>): Promise<CliRun> =>
  runCliIn({ cwd }, ...args);

const pageOf = (html: string) =>
  pageIn(id => new RegExp(`id="${id}">([\\s\\S]*?)</script>`).exec(html)?.[1]);

const reviewDataIn = (html: string) => pageOf(html).data;

test('writes the review page for a range into .reviews/, with slashes in revision names made filename-safe, and its data beside it, naming the repo by its folder and stamped with the versions of the parsers it read with', async () => {
  using workspace = cargoWorkspace();
  const { repo } = workspace;
  git(repo, 'switch', '--quiet', '--create', 'feature/cli');
  commit(repo, axumCrate('cli'));

  const run = await runCli(repo, 'main..feature/cli');

  const page = join(repo, '.reviews', 'main..feature_cli.html');
  expect(run).toMatchObject({ code: 0, stdout: `${page}\n` });
  const reviewData = reviewDataIn(readFileSync(page, 'utf8'));
  expect(reviewData).toMatchObject({
    repo: basename(repo),
    range: 'main..feature/cli',
    diff: {
      nodes: expect.arrayContaining([
        expect.objectContaining({ id: 'rust/crate/cli', state: 'added' }),
      ]),
    },
    parsers: {
      '@babel/parser': expect.stringMatching(/^\d+\.\d+\.\d+/),
      'tree-sitter-ruby': expect.stringMatching(/^\d+\.\d+\.\d+/),
      'tree-sitter-rust': expect.stringMatching(/^\d+\.\d+\.\d+/),
      'web-tree-sitter': expect.stringMatching(/^\d+\.\d+\.\d+/),
    },
  });
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

test("the CLI, with every reader loaded, parses Rust as Rust: a crate's modules are drawn and its test changes read", async () => {
  using workspace = cargoWorkspace();
  const { repo } = workspace;
  writeFiles(repo, {
    'crates/core/src/lib.rs': 'mod a;\n',
    'crates/core/src/a.rs': '#[test]\nfn checks() {}\n',
  });

  await runCli(repo);

  const page = readFileSync(join(repo, '.reviews', 'HEAD..worktree.html'), 'utf8');
  expect(reviewDataIn(page)).toMatchObject({
    diff: {
      nodes: expect.arrayContaining([expect.objectContaining({ id: 'rust/mod/core/a' })]),
    },
    tests: [expect.objectContaining({ path: 'crates/core/src/a.rs' })],
  });
}, 60_000);

test("the uncommitted work's churn counts up to HEAD on the head side too, the uncommitted edit left out", async () => {
  using workspace = cargoWorkspace();
  const { repo } = workspace;
  writeFiles(repo, { 'crates/core/src/lib.rs': 'pub fn edited() {}\n' });

  await runCli(repo);

  const page = readFileSync(join(repo, '.reviews', 'HEAD..worktree.html'), 'utf8');
  expect(reviewDataIn(page).metrics['rust/mod/core/lib.rs']).toEqual({
    base: expect.objectContaining({ churn: 1 }),
    head: expect.objectContaining({ churn: 1 }),
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

test('a PR number reviews the PR from its merge base to its head, so its new crate shows as added, names the page by that sha range, and names the repo as its URL does', async () => {
  using pr = pullRequestRemote();

  const run = await runCliIn({ cwd: pr.clone, env: { ...process.env, PATH: pr.path } }, '7');

  const range = `${pr.branchPoint}..${pr.head}`;
  const page = join(pr.clone, '.reviews', `${range}.html`);
  expect(run).toMatchObject({ code: 0, stdout: `${page}\n` });
  expect(reviewDataIn(readFileSync(page, 'utf8'))).toMatchObject({
    repo: 'acme/shop',
    range,
    pullRequest: { number: 7, title: 'Add the cli crate' },
    diff: {
      nodes: expect.arrayContaining([
        expect.objectContaining({ id: 'rust/crate/cli', state: 'added' }),
      ]),
    },
  });
}, 60_000);

test("a PR's next round lists what changed since its last review, a merge of the base left out", async () => {
  using pr = pullRequestRemote();
  const options = { cwd: pr.clone, env: { ...process.env, PATH: pr.path } };
  const firstRange = `${pr.branchPoint}..${pr.head}`;
  await runCliIn(options, '7');
  const first = reviewDataIn(
    readFileSync(join(pr.clone, '.reviews', `${firstRange}.html`), 'utf8'),
  );
  expect(first).not.toHaveProperty('sinceReview');
  writeFileSync(
    join(pr.clone, '.reviews', `${firstRange}.review.json`),
    JSON.stringify({
      version: 6,
      verdict: 'request-changes',
      reviewed: { range: firstRange, pullRequest: 7 },
      read: [],
      resolved: [],
      comments: [],
    }),
  );
  const pushed = pr.mergeBaseAndPush({ 'crates/cli/src/lib.rs': 'pub fn run() {}\n' });

  const run = await runCliIn(options, '7');

  expect(run.code).toBe(0);
  const next = reviewDataIn(readFileSync(run.stdout.trim(), 'utf8'));
  expect(next.range.endsWith(pushed)).toBe(true);
  expect(next.sinceReview).toMatchObject({
    head: pr.head,
    verdict: 'request-changes',
    changed: {
      nodes: ['rust/crate/cli', 'rust/mod/cli/lib.rs'],
      edges: [],
      dropped: { nodes: [], edges: [] },
    },
  });
}, 120_000);

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

test('a link standing where a review writes is replaced by the file, what it points at left as it was', async () => {
  using workspace = cargoWorkspace();
  const { repo } = workspace;
  const elsewhere = join(repo, 'elsewhere');
  writeFileSync(elsewhere, 'mine\n');
  mkdirSync(join(repo, '.reviews'));
  ['.gitignore', 'HEAD..worktree.html', 'HEAD..worktree.json'].forEach(file => {
    symlinkSync(elsewhere, join(repo, '.reviews', file));
  });
  commit(repo, { 'elsewhere-too': '' });

  const run = await runCli(repo);

  expect(run.code).toBe(0);
  expect(readFileSync(elsewhere, 'utf8')).toBe('mine\n');
  expect(
    reviewDataIn(readFileSync(join(repo, '.reviews', 'HEAD..worktree.html'), 'utf8')),
  ).toMatchObject({ range: 'HEAD..worktree' });
  expect(readFileSync(join(repo, '.reviews', '.gitignore'), 'utf8')).toBe('*\n');
  expect(
    JSON.parse(readFileSync(join(repo, '.reviews', 'HEAD..worktree.json'), 'utf8')),
  ).toMatchObject({ range: 'HEAD..worktree' });
}, 60_000);

const webRepo = () =>
  gitRepo({ 'package.json': '{"name":"web"}', 'src/a.ts': 'export const a = 1;\n' });

const runCliOnBoundedMemory = (cwd: string, ...args: ReadonlyArray<string>): Promise<CliRun> =>
  promisify(execFile)(
    'sh',
    [
      '-c',
      'ulimit -d 2097152; stdin=$(mktemp -u); mkfifo "$stdin"; exec 3<>"$stdin"; rm "$stdin"; exec "$@" <&3 3<&-',
      'sh',
      process.execPath,
      join(import.meta.dirname, 'cli.ts'),
      ...args,
    ],
    { cwd, timeout: 20_000, killSignal: 'SIGKILL' },
  ).then(ranToTheEnd, stoppedShort);

test.each([
  { name: 'a device that never ends', links: { 'src/zero.ts': '/dev/zero' } },
  { name: 'a device that never answers', links: { 'src/stdin.ts': '/dev/stdin' } },
  {
    name: 'a file with no end the system calls regular',
    links: { 'src/map.ts': '/proc/self/pagemap' },
  },
  { name: 'a device, at a manifest a reader reads', links: { 'tsconfig.json': '/dev/zero' } },
  { name: 'nothing', links: { 'src/gone.ts': '/nonexistent/gone' } },
  { name: 'a device, under a name git quotes', links: { 'src/a\tb "c".ts': '/dev/zero' } },
])(
  'a link in the range leaving the repo for $name is not followed, and the review names it as changed',
  async ({ links }) => {
    using workspace = webRepo();
    const { repo } = workspace;
    Object.entries(links).forEach(([path, target]) => {
      symlinkSync(target, join(repo, path));
    });
    commit(repo, { 'src/a.ts': 'export const a = 2;\n' });

    const run = await runCliOnBoundedMemory(repo, 'HEAD~1..HEAD');

    expect(run.code).toBe(0);
    const page = readFileSync(join(repo, '.reviews', 'HEAD~1..HEAD.html'), 'utf8');
    expect(reviewDataIn(page).undrawn.map(({ path }) => path)).toEqual(
      expect.arrayContaining(Object.keys(links)),
    );
  },
  30_000,
);

const upToTheRoot = '../'.repeat(20);

test.each([
  {
    name: 'rootDir',
    settings: (repo: string) => ({ compilerOptions: { rootDir: `${upToTheRoot}${repo}/src` } }),
    files: () => ({}),
  },
  {
    name: 'one include folder',
    settings: (repo: string) => ({ include: [`${upToTheRoot}${repo}/src/*`] }),
    files: () => ({}),
  },
  {
    name: 'absolute rootDir',
    settings: () => ({ compilerOptions: { rootDir: '/nowhere/src' } }),
    files: () => ({ 'nowhere/src/mirror.ts': 'export const m = 1;\n' }),
  },
])(
  'a tsconfig whose $name leaves the checkout is not followed, and the stack reads its src',
  async ({ settings, files }) => {
    using workspace = webRepo();
    const { repo } = workspace;
    symlinkSync('/dev/stdin', join(repo, 'src/stdin.ts'));
    commit(repo, {
      ...files(),
      'tsconfig.json': JSON.stringify(settings(repo)),
      'src/a.ts': 'export const a = 2;\n',
    });

    const run = await runCliOnBoundedMemory(repo, 'HEAD~1..HEAD');

    expect(run.code).toBe(0);
    const page = readFileSync(join(repo, '.reviews', 'HEAD~1..HEAD.html'), 'utf8');
    expect(reviewDataIn(page).diff.nodes).toContainEqual(
      expect.objectContaining({ id: 'web/file/a.ts', state: 'modified' }),
    );
  },
  30_000,
);

test('a tsconfig rootDir reaching out of its package but not the checkout is still followed', async () => {
  using workspace = gitRepo({
    'packages/a/package.json': '{"name":"a"}',
    'packages/a/tsconfig.json': '{"compilerOptions":{"rootDir":"../.."}}',
    'packages/a/index.ts': 'export const a = 1;\n',
  });
  const { repo } = workspace;
  commit(repo, { 'packages/a/index.ts': 'export const a = 2;\n' });

  const run = await runCliOnBoundedMemory(repo, 'HEAD~1..HEAD');

  expect(run.code).toBe(0);
  const page = readFileSync(join(repo, '.reviews', 'HEAD~1..HEAD.html'), 'utf8');
  expect(reviewDataIn(page).diff.nodes.map(({ id }) => id)).toContain(
    'packages/a/file/packages/a/index.ts',
  );
}, 30_000);

test('a link a sparse checkout leaves out of the checkout does not stop the review', async () => {
  using workspace = webRepo();
  const { repo } = workspace;
  mkdirSync(join(repo, 'docs'));
  symlinkSync('../src/a.ts', join(repo, 'docs/near.ts'));
  commit(repo, { 'src/a.ts': 'export const a = 2;\n' });
  git(repo, 'sparse-checkout', 'set', 'src');
  commit(repo, { 'src/a.ts': 'export const a = 3;\n' });

  const run = await runCliOnBoundedMemory(repo, 'HEAD~1..HEAD');

  expect(run).toMatchObject({ code: 0 });
}, 30_000);

test.each([
  { name: 'a device', target: '/dev/stdin' },
  { name: 'a file with no end the system calls regular', target: '/proc/self/pagemap' },
  { name: 'a folder', target: './src' },
])(
  'a config link in the working tree to $name stops the review, naming the file',
  async ({ target }) => {
    using workspace = webRepo();
    const { repo } = workspace;
    commit(repo, { 'src/a.ts': 'export const a = 2;\n' });
    symlinkSync(target, join(repo, 'visual-review.config.json'));

    const run = await runCliOnBoundedMemory(repo, 'HEAD~1..HEAD');

    expect(run.code).toBe(1);
    expect(run.stderr).toContain('visual-review.config.json: not a regular file with contents');
  },
  30_000,
);

test('a config link git tracks leaving the repo stops the review, showing nothing of what it points at', async () => {
  using workspace = webRepo();
  const { repo } = workspace;
  commit(repo, { 'src/a.ts': 'export const a = 2;\n' });
  using elsewhere = gitRepo({ 'secret.txt': 'hunter2 is the password' });
  symlinkSync(join(elsewhere.repo, 'secret.txt'), join(repo, 'visual-review.config.json'));
  commit(repo, { 'src/a.ts': 'export const a = 3;\n' });

  const run = await runCliOnBoundedMemory(repo, 'HEAD~2..HEAD~1');

  expect(run.code).toBe(1);
  expect(run.stderr).toContain(
    'visual-review.config.json: a tracked link leaving the repo is not read',
  );
  expect(run.stderr).not.toContain('hunter2');
}, 30_000);

test('a config link git tracks staying in the repo applies', async () => {
  using workspace = webRepo();
  const { repo } = workspace;
  commit(repo, { 'src/a.ts': 'export const a = 2;\n' });
  writeFileSync(join(repo, 'mine.json'), '{"stacks":{"web":false}}');
  symlinkSync('./mine.json', join(repo, 'visual-review.config.json'));
  commit(repo, { 'src/a.ts': 'export const a = 3;\n' });

  const run = await runCliOnBoundedMemory(repo, 'HEAD~2..HEAD~1');

  expect(run.code).toBe(0);
  const page = readFileSync(join(repo, '.reviews', 'HEAD~2..HEAD~1.html'), 'utf8');
  expect(reviewDataIn(page).diff.nodes).toEqual([]);
}, 30_000);

test('a config link in the working tree to a file outside the repo applies', async () => {
  using workspace = webRepo();
  const { repo } = workspace;
  commit(repo, { 'src/a.ts': 'export const a = 2;\n' });
  using elsewhere = gitRepo({ 'shared.json': '{"stacks":{"web":false}}' });
  symlinkSync(join(elsewhere.repo, 'shared.json'), join(repo, 'visual-review.config.json'));

  const run = await runCliOnBoundedMemory(repo, 'HEAD~1..HEAD');

  expect(run.code).toBe(0);
  const page = readFileSync(join(repo, '.reviews', 'HEAD~1..HEAD.html'), 'utf8');
  expect(reviewDataIn(page).diff.nodes).toEqual([]);
}, 30_000);

test('a link in the range staying in the repo is read as the file it points at', async () => {
  using workspace = webRepo();
  const { repo } = workspace;
  symlinkSync('./a.ts', join(repo, 'src/near.ts'));
  commit(repo, { 'src/a.ts': 'export const a = 2;\n' });

  const run = await runCliOnBoundedMemory(repo, 'HEAD~1..HEAD');

  expect(run.code).toBe(0);
  const page = readFileSync(join(repo, '.reviews', 'HEAD~1..HEAD.html'), 'utf8');
  expect(reviewDataIn(page).undrawn).toEqual([]);
}, 30_000);

test('a link in the range resolving to the repo root keeps the edge drawn through it', async () => {
  using workspace = webRepo();
  const { repo } = workspace;
  mkdirSync(join(repo, 'tools'));
  symlinkSync('..', join(repo, 'tools/root'));
  commit(repo, {
    'src/b.ts': "import { a } from '../tools/root/src/a.ts';\nexport const b = a;\n",
  });

  const run = await runCliOnBoundedMemory(repo, 'HEAD~1..HEAD');

  expect(run.code).toBe(0);
  const page = readFileSync(join(repo, '.reviews', 'HEAD~1..HEAD.html'), 'utf8');
  expect(reviewDataIn(page).diff.edges).toEqual([
    expect.objectContaining({ from: 'web/file/b.ts', to: 'web/file/a.ts' }),
  ]);
}, 30_000);

test('--notes replaces a link standing at the page with the noted page, what it points at left as it was', async () => {
  using workspace = cargoWorkspace();
  const { repo } = workspace;
  await runCli(repo, 'main..main');
  const page = join(repo, '.reviews', 'main..main.html');
  const elsewhere = join(repo, 'elsewhere.html');
  const written = readFileSync(page, 'utf8');
  writeFileSync(elsewhere, written);
  rmSync(page);
  symlinkSync(elsewhere, page);
  const notesFile = join(repo, 'notes.json');
  const notes = { version: 1, summary: [{ text: 'Nothing moves.' }], tests: 'None.', notes: {} };
  writeFileSync(notesFile, JSON.stringify(notes));

  const run = await runCli(repo, 'main..main', '--notes', notesFile);

  expect(run.code).toBe(0);
  expect(readFileSync(elsewhere, 'utf8')).toBe(written);
  expect(pageOf(readFileSync(page, 'utf8')).notes).toEqual(notes);
}, 60_000);

test('run from a folder the branch lays out as a bare repository, a review refuses it and its config runs nothing', async () => {
  using workspace = cargoWorkspace();
  const { repo } = workspace;
  const planted = join(repo, 'planted');
  const ran = join(repo, 'ran');
  layOutBareRepository({ directory: planted, monitorTouches: ran });

  const run = await runCli(planted);

  expect(run.code).not.toBe(0);
  expect(existsSync(ran)).toBe(false);
}, 60_000);

const gitIgnoringBareRepositorySetting = () => {
  const bin = mkdtempSync(join(tmpdir(), 'visual-review-bin-'));
  const real = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  writeFileSync(
    join(bin, 'git'),
    `#!/bin/sh\nif [ "$1" = -c ] && [ "$2" = safe.bareRepository=explicit ]; then shift 2; fi\nexec ${real} "$@"\n`,
    { mode: 0o755 },
  );
  return { path: bin, [Symbol.dispose]: () => rmSync(bin, { recursive: true, force: true }) };
};

test('under a git that ignores the bare repository setting, a folder with no .git is still refused and its config runs nothing', async () => {
  using workspace = cargoWorkspace();
  const { repo } = workspace;
  const planted = join(repo, 'planted');
  const ran = join(repo, 'ran');
  layOutBareRepository({ directory: planted, monitorTouches: ran });
  using oldGit = gitIgnoringBareRepositorySetting();

  const run = await runCliIn({
    cwd: planted,
    env: { ...process.env, PATH: `${oldGit.path}:${process.env['PATH']}` },
  });

  expect(run.code).not.toBe(0);
  expect(run.stderr).toContain('no .git');
  expect(existsSync(ran)).toBe(false);
}, 60_000);

test('a linked worktree, whose .git is a file, is reviewed from a folder inside it', async () => {
  using workspace = cargoWorkspace();
  const { repo } = workspace;
  const linked = `${repo}-linked`;
  git(repo, 'worktree', 'add', '--quiet', '--detach', linked);
  const inside = join(linked, 'crates');

  const run = await runCli(inside, 'main..main');

  rmSync(linked, { recursive: true, force: true });
  expect(run).toMatchObject({
    code: 0,
    stdout: `${join(linked, '.reviews', 'main..main.html')}\n`,
  });
}, 60_000);

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

test('--notes fills the notes into the page already written for the range, without reading the range again', async () => {
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
    notes: { 'rust/crate/cli': { text: 'A second way in.', flag: 'new entry point' } },
  };
  const notesFile = join(repo, 'notes.json');
  writeFileSync(notesFile, JSON.stringify(notes));

  const run = await runCli(repo, 'main..feature', '--notes', notesFile);

  expect(run.code).toBe(0);
  const html = readFileSync(join(repo, '.reviews', 'main..feature.html'), 'utf8');
  expect(pageOf(html).notes).toEqual(notes);
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

test.for([
  {
    problem: 'name a part not in the graph',
    notes: { 'rust/crate/gone': { text: 'Removed.' } },
    pageFrom: (html: string) => html,
    says: "notes.json don't match the graph:\nunknown id rust/crate/gone",
  },
  {
    problem: 'are for a page another visual-review wrote',
    notes: { 'rust/crate/cli': { text: 'A second way in.' } },
    pageFrom: (html: string) => html.replace(/"version":"[^"]*"/, '"version":"0.0.1"'),
    says: 'written by visual-review 0.0.1',
  },
])(
  'notes that $problem exit non-zero saying so and leave the page as it was',
  { timeout: 60_000 },
  async ({ notes, pageFrom, says }) => {
    using workspace = cargoWorkspace();
    const { repo } = workspace;
    git(repo, 'switch', '--quiet', '--create', 'feature');
    commit(repo, crateFiles('cli'));
    await runCli(repo, 'main..feature');
    const pagePath = join(repo, '.reviews', 'main..feature.html');
    const page = pageFrom(readFileSync(pagePath, 'utf8'));
    writeFileSync(pagePath, page);
    const notesFile = join(repo, 'notes.json');
    writeFileSync(notesFile, JSON.stringify({ version: 1, summary: [], tests: '', notes }));

    const run = await runCli(repo, 'main..feature', '--notes', notesFile);

    expect(run.code).not.toBe(0);
    expect(run.stderr).toContain(says);
    expect(readFileSync(pagePath, 'utf8')).toBe(page);
  },
);

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
