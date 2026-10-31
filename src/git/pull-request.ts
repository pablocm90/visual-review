import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { PullRequest } from '../core/page.ts';

const run = promisify(execFile);

const PullRequestViewSchema = z.object({
  baseRefName: z.string(),
  mergeCommit: z.object({ oid: z.string() }).nullable(),
  title: z.string(),
  url: z.string(),
});

type PullRequestOptions = {
  readonly repo: string;
  readonly number: number;
};

const namesRepository = (remoteUrl: string, repository: string): boolean => {
  const path = remoteUrl.replace(/\.git$/, '');
  return path.endsWith(`/${repository}`) || path.endsWith(`:${repository}`);
};

type ExecFailure = { readonly stderr: string };

type FetchedPullRequest = PullRequest & {
  readonly repository: string;
  readonly from: string;
  readonly to: string;
};

export const readPullRequest = async ({
  repo,
  number,
}: PullRequestOptions): Promise<FetchedPullRequest> => {
  const git = async (...args: ReadonlyArray<string>): Promise<string> =>
    (await run('git', ['-C', repo, ...args])).stdout.trim();
  const view = await run(
    'gh',
    ['pr', 'view', String(number), '--json', 'baseRefName,mergeCommit,title,url'],
    { cwd: repo },
  ).catch((error: ExecFailure) => {
    throw new Error(`Could not read PR #${number}: ${error.stderr.trim()}`);
  });
  const { baseRefName, mergeCommit, title, url } = PullRequestViewSchema.parse(
    JSON.parse(view.stdout),
  );
  const repository = new URL(url).pathname.split('/').slice(1, 3).join('/');
  const remoteUrls = await git('config', '--get-regexp', '^remote\\..*\\.url$').catch(() => '');
  const remote = remoteUrls.split('\n').flatMap(line => {
    const [key = '', remoteUrl = ''] = line.split(' ');
    return namesRepository(remoteUrl, repository)
      ? [key.slice('remote.'.length, -'.url'.length)]
      : [];
  })[0];
  if (remote === undefined) throw new Error(`No git remote points at ${repository}`);
  const fetched = async (ref: string): Promise<string> => {
    await git('fetch', '--quiet', remote, ref).catch((error: ExecFailure) => {
      throw new Error(`Could not fetch PR #${number} from ${remote}: ${error.stderr.trim()}`);
    });
    return git('rev-parse', 'FETCH_HEAD');
  };
  const to = await fetched(`refs/pull/${number}/head`);
  const baseTip = await fetched(`refs/heads/${baseRefName}`);
  const base = mergeCommit === null ? baseTip : `${mergeCommit.oid}^1`;
  return { repository, from: await git('merge-base', base, to), to, number, title, url };
};
