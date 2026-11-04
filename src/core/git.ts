import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const gitUntrimmed = async (repo: string, ...args: ReadonlyArray<string>): Promise<string> =>
  (await run('git', ['-C', repo, ...args], { maxBuffer: Number.POSITIVE_INFINITY })).stdout;

export const git = async (repo: string, ...args: ReadonlyArray<string>): Promise<string> =>
  (await gitUntrimmed(repo, ...args)).trim();
