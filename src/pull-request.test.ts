import { expect, test, vi } from 'vitest';
import { readPullRequest } from './pull-request.ts';
import { git } from './test-support/cargo-workspace.ts';
import { pullRequestRemote } from './test-support/pull-request-remote.ts';

test.for([
  { state: 'an open', merged: false },
  { state: 'a merged', merged: true },
])(
  '$state PR resolves to the range from where it branched off its base to its head, fetched into a clone that has neither, though the base has moved on since',
  async ({ merged }) => {
    using pr = pullRequestRemote({ merged });
    vi.stubEnv('PATH', pr.path);

    const pullRequest = await readPullRequest({ repo: pr.clone, number: 7 });

    expect(pullRequest).toEqual({
      from: pr.branchPoint,
      to: pr.head,
      number: 7,
      title: 'Add the cli crate',
      url: 'https://github.com/acme/shop/pull/7',
    });
  },
);

test.for([
  {
    failure: 'gh does not know the PR',
    number: 99,
    arrange: () => {},
    message: 'Could not read PR #99: no pull requests found for 99',
  },
  {
    failure: 'the remote has no head for the PR',
    number: 7,
    arrange: (pr: ReturnType<typeof pullRequestRemote>) =>
      git(pr.repository, 'update-ref', '-d', 'refs/pull/7/head'),
    message: 'Could not fetch PR #7',
  },
  {
    failure: 'no remote names the repository',
    number: 7,
    arrange: (pr: ReturnType<typeof pullRequestRemote>) =>
      git(pr.clone, 'remote', 'remove', 'upstream'),
    message: 'No git remote points at acme/shop',
  },
  {
    failure: 'the clone has no remotes at all',
    number: 7,
    arrange: (pr: ReturnType<typeof pullRequestRemote>) => {
      git(pr.clone, 'remote', 'remove', 'upstream');
      git(pr.clone, 'remote', 'remove', 'origin');
    },
    message: 'No git remote points at acme/shop',
  },
])('when $failure, the error says so', async ({ number, arrange, message }) => {
  using pr = pullRequestRemote();
  vi.stubEnv('PATH', pr.path);
  arrange(pr);

  await expect(readPullRequest({ repo: pr.clone, number })).rejects.toThrow(message);
});

test.for([
  { form: 'ssh', repositoryUrl: 'git@github.com:acme/shop.git' },
  { form: 'https', repositoryUrl: 'https://github.com/acme/shop' },
])(
  "a PR is fetched from the remote that names its repository over $form, whatever the remote's name, not from a fork's origin",
  async ({ repositoryUrl }) => {
    using pr = pullRequestRemote({ repositoryUrl });
    vi.stubEnv('PATH', pr.path);

    const pullRequest = await readPullRequest({ repo: pr.clone, number: 7 });

    expect(pullRequest).toMatchObject({ from: pr.branchPoint, to: pr.head });
  },
);
