import { expect, test } from 'vitest';
import { migrationFindings } from './migration-findings.ts';

const FILE = 'db/migrate/20261105_drop_name.rb';

const risk = (title: string, line = 3) => ({
  title,
  why: 'Code still running during the deploy may read it.',
  line,
});

test("a migration's risk is a schema finding to look at, opening its file, saying where and why", () => {
  expect(
    migrationFindings([{ file: FILE, risks: [risk('column users.name removed')] }]),
  ).toStrictEqual([
    {
      id: `schema:${FILE}:column users.name removed`,
      dimension: 'schema',
      level: 'look',
      file: FILE,
      title: 'column users.name removed',
      detail: `${FILE}:3. Code still running during the deploy may read it.`,
    },
  ]);
});

test('a risk repeated in a file gets an id of its own, counted within that file', () => {
  const other = 'db/migrate/20261106_drop_again.rb';
  const title = 'column users.name removed';

  expect(
    migrationFindings([
      { file: FILE, risks: [risk(title), risk('column users.age removed'), risk(title, 9)] },
      { file: other, risks: [risk(title)] },
    ]).map(({ id }) => id),
  ).toStrictEqual([
    `schema:${FILE}:${title}`,
    `schema:${FILE}:column users.age removed`,
    `schema:${FILE}:${title}#2`,
    `schema:${other}:${title}`,
  ]);
});

test("a migration that couldn't be read is a finding to look at, naming why", () => {
  expect(migrationFindings([{ file: FILE, notRead: 'Ruby syntax error' }])).toStrictEqual([
    {
      id: `schema:not-read:${FILE}`,
      dimension: 'schema',
      level: 'look',
      file: FILE,
      title: `${FILE} not read: Ruby syntax error`,
    },
  ]);
});
