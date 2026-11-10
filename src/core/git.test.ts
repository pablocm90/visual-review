import { expect, test } from 'vitest';
import { commit, git, gitRepo } from '../test-support/repos.ts';
import { filesHeldAt } from './git.ts';

test('the files a revision holds read whole, by path, whatever their bytes or names', async () => {
  using workspace = gitRepo({
    'app/a.rb': 'class Café; end # ☕\n',
    'app/empty.rb': '',
    'app/no newline.rb': 'x',
    'app/two\nlines.rb': 'y\n\n',
    'app/a\ttab.rb': 'z\n',
    'lib/b.rb': 'not held\n',
  });
  const { repo, root } = workspace;
  commit(repo, { 'app/a.rb': 'changed later\n' });

  const files = await filesHeldAt({ repo, revision: root, holds: path => path.startsWith('app/') });

  expect(files).toEqual(
    new Map([
      ['app/a.rb', 'class Café; end # ☕\n'],
      ['app/empty.rb', ''],
      ['app/no newline.rb', 'x'],
      ['app/two\nlines.rb', 'y\n\n'],
      ['app/a\ttab.rb', 'z\n'],
    ]),
  );
});

test('a revision holding no file the reader wants reads as none', async () => {
  using workspace = gitRepo({ 'lib/b.rb': 'b\n' });
  const { repo, root } = workspace;

  expect(await filesHeldAt({ repo, revision: root, holds: () => false })).toEqual(new Map());
});

test('a submodule at a path the reader wants is no file of the revision', async () => {
  using workspace = gitRepo({ 'app/a.rb': 'a\n' });
  const { repo, root } = workspace;
  git(repo, 'update-index', '--add', '--cacheinfo', `160000,${root},app/vendored.rb`);
  git(repo, 'commit', '--quiet', '--message', 'submodule');
  const revision = git(repo, 'rev-parse', 'HEAD');

  expect(await filesHeldAt({ repo, revision, holds: () => true })).toEqual(
    new Map([['app/a.rb', 'a\n']]),
  );
});
