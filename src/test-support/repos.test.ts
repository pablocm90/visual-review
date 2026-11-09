import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { git, gitRepo } from './repos.ts';

const blobId = (content: string): string =>
  createHash('sha1')
    .update(`blob ${Buffer.byteLength(content)}\0${content}`)
    .digest('hex');

const filesGitSamplesAsTooManyLooseObjects = (): Readonly<Record<string, string>> =>
  Object.fromEntries(
    Array.from({ length: 20_000 }, (_, n) => `${n}\n`)
      .filter(content => blobId(content).startsWith('17'))
      .slice(0, 28)
      .map((content, n) => [`file-${n}.txt`, content]),
  );

test("git's automatic maintenance packs nothing in a test's repo, which its disposal could race", () => {
  using workspace = gitRepo(filesGitSamplesAsTooManyLooseObjects());

  git(workspace.repo, 'maintenance', 'run', '--auto', '--no-detach');

  expect(readdirSync(join(workspace.repo, '.git', 'objects', 'pack'))).toEqual([]);
});
