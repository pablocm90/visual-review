import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const gitUntrimmed = async (repo: string, ...args: ReadonlyArray<string>): Promise<string> =>
  (await run('git', ['-C', repo, ...args], { maxBuffer: Number.POSITIVE_INFINITY })).stdout;

export const git = async (repo: string, ...args: ReadonlyArray<string>): Promise<string> =>
  (await gitUntrimmed(repo, ...args)).trim();

type HeldAt = {
  readonly repo: string;
  readonly revision: string;
  readonly holds: (path: string) => boolean;
};

export const filesHeldAt = async ({
  repo,
  revision,
  holds,
}: HeldAt): Promise<ReadonlyMap<string, string>> => {
  const listed = await gitUntrimmed(repo, 'ls-tree', '-r', '-z', '--name-only', revision);
  return new Map(
    await Promise.all(
      listed
        .split('\0')
        .filter(holds)
        .map(
          async file => [file, await gitUntrimmed(repo, 'show', `${revision}:${file}`)] as const,
        ),
    ),
  );
};
