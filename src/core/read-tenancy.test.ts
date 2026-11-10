import { expect, test } from 'vitest';
import { readRange } from '../test-support/read-range.ts';
import { commit, gitRepo } from '../test-support/repos.ts';

const APARTMENT = 'config/initializers/apartment.rb';

const apartment = (models: string) =>
  `Apartment.configure do |config|\n  config.excluded_models = %w[${models}]\nend\n`;

test("a range reading reads Apartment's config at both sides", async () => {
  using workspace = gitRepo({ [APARTMENT]: apartment('Company') });
  const { repo, root } = workspace;
  const to = commit(repo, { [APARTMENT]: apartment('Company User') });

  const { tenancy } = await readRange({ repo, from: root, to });

  expect(tenancy).toMatchObject([
    {
      base: { configs: [{ excluded: ['Company'] }] },
      head: { configs: [{ excluded: ['Company', 'User'] }] },
    },
  ]);
});

test("Apartment's config is read when the change leaves it as it was", async () => {
  using workspace = gitRepo({ [APARTMENT]: apartment('Company'), 'README.md': 'shop\n' });
  const { repo, root } = workspace;
  const to = commit(repo, { 'README.md': 'the shop\n' });

  const { tenancy } = await readRange({ repo, from: root, to });

  expect(tenancy).toMatchObject([{ head: { configs: [{ excluded: ['Company'] }] } }]);
});
