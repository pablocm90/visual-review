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

test("git's automatic gc packs nothing in a test's repo, which its disposal could race", () => {
  using workspace = gitRepo(filesGitSamplesAsTooManyLooseObjects());
  const objects = join(workspace.repo, '.git', 'objects');
  expect(readdirSync(join(objects, '17')).length).toBeGreaterThan(27);

  git(workspace.repo, '-c', 'gc.autoDetach=false', 'gc', '--auto', '--quiet');

  expect(readdirSync(join(objects, 'pack'))).toEqual([]);
});
