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

type Blob = { readonly object: string; readonly path: string };

const blobsAt = async ({ repo, revision, holds }: HeldAt): Promise<ReadonlyArray<Blob>> =>
  (await gitUntrimmed(repo, 'ls-tree', '-r', '-z', revision))
    .split('\0')
    .map(entry => {
      const tab = entry.indexOf('\t');
      const [, type, object = ''] = entry.slice(0, tab).split(' ');
      return { type, object, path: entry.slice(tab + 1) };
    })
    .filter(({ type, path }) => type === 'blob' && holds(path));

const filesIn = (output: Buffer, blobs: ReadonlyArray<Blob>): ReadonlyMap<string, string> => {
  let at = 0;
  return new Map(
    blobs.map(({ path }) => {
      const headerEnd = output.indexOf('\n', at);
      const start = headerEnd + 1;
      const end = start + Number(output.toString('utf8', at, headerEnd).split(' ')[2]);
      at = end + 1;
      return [path, output.toString('utf8', start, end)];
    }),
  );
};

export const filesHeldAt = async (held: HeldAt): Promise<ReadonlyMap<string, string>> => {
  const blobs = await blobsAt(held);
  const reading = run('git', ['-C', held.repo, 'cat-file', '--batch'], {
    encoding: 'buffer',
    maxBuffer: Number.POSITIVE_INFINITY,
  });
  reading.child.stdin?.end(blobs.map(({ object }) => `${object}\n`).join(''));
  return filesIn((await reading).stdout, blobs);
};
