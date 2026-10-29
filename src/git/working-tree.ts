import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const snapshotWorkingTree = async (repo: string): Promise<string> => {
  const scratch = await mkdtemp(join(tmpdir(), 'visual-review-index-'));
  const env = { ...process.env, GIT_INDEX_FILE: join(scratch, 'index') };
  const git = async (...args: ReadonlyArray<string>): Promise<string> =>
    (await run('git', ['-C', repo, ...args], { env })).stdout.trim();
  try {
    await git('add', '--all');
    const tree = await git('write-tree');
    return await git('commit-tree', tree, '-p', 'HEAD', '-m', 'visual-review: working tree');
  } finally {
    await rm(scratch, { recursive: true });
  }
};
