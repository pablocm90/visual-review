import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { cargoWorkspace, commit, crateFiles, git } from './cargo-workspace.ts';

const REPOSITORY_SSH_URL = 'git@github.com:acme/shop.git';
const FORK_SSH_URL = 'git@github.com:someone/shop.git';

type FakeGhOptions = {
  readonly bin: string;
  readonly clone: string;
  readonly number: number;
  readonly view: object;
};

const fakeGh = ({ bin, clone, number, view }: FakeGhOptions): void => {
  const gh = join(bin, 'gh');
  writeFileSync(
    gh,
    `#!/bin/sh
[ "$(pwd -P)" = "${realpathSync(clone)}" ] || exit 1
[ "$*" = "pr view ${number} --json baseRefName,mergeCommit,title,url" ] || { echo "no pull requests found for $3" >&2; exit 1; }
echo '${JSON.stringify(view)}'
`,
  );
  chmodSync(gh, 0o755);
};

type PullRequestRemoteOptions = {
  readonly merged?: boolean;
  readonly repositoryUrl?: string;
};

export const pullRequestRemote = ({
  merged = false,
  repositoryUrl = REPOSITORY_SSH_URL,
}: PullRequestRemoteOptions = {}) => {
  const upstream = cargoWorkspace();
  const scratch = mkdtempSync(join(tmpdir(), 'visual-review-pr-'));
  const repository = join(scratch, 'repository.git');
  const clone = join(scratch, 'clone');
  const bin = join(scratch, 'bin');
  git(upstream.repo, 'switch', '--quiet', '--create', 'release');
  const branchPoint = commit(upstream.repo, crateFiles('shared'));
  git(scratch, 'clone', '--quiet', '--bare', upstream.repo, repository);
  git(repository, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  git(scratch, 'clone', '--quiet', '--origin', 'upstream', repository, clone);
  git(clone, 'remote', 'set-url', 'upstream', repositoryUrl);
  git(clone, 'config', `url.${repository}.insteadOf`, repositoryUrl);
  git(clone, 'remote', 'add', 'origin', FORK_SSH_URL);
  git(clone, 'config', `url.${join(scratch, 'fork.git')}.insteadOf`, FORK_SSH_URL);
  git(upstream.repo, 'switch', '--quiet', '--create', 'feature');
  const head = commit(upstream.repo, crateFiles('cli'));
  git(upstream.repo, 'switch', '--quiet', 'release');
  commit(upstream.repo, crateFiles('later'));
  if (merged) git(upstream.repo, 'merge', '--quiet', '--no-ff', '--no-edit', 'feature');
  const mergeCommit = merged ? { oid: git(upstream.repo, 'rev-parse', 'HEAD') } : null;
  git(upstream.repo, 'push', '--quiet', repository, 'feature:refs/pull/7/head', 'release');
  mkdirSync(bin);
  fakeGh({
    bin,
    clone,
    number: 7,
    view: {
      baseRefName: 'release',
      mergeCommit,
      title: 'Add the cli crate',
      url: 'https://github.com/acme/shop/pull/7',
    },
  });
  return {
    repository,
    clone,
    branchPoint,
    head,
    path: `${bin}${delimiter}${process.env['PATH'] ?? ''}`,
    [Symbol.dispose]: () => {
      upstream[Symbol.dispose]();
      rmSync(scratch, { recursive: true, force: true });
    },
  };
};
