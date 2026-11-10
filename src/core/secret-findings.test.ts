import { expect, test } from 'vitest';
import { secretFindings } from './secret-findings.ts';

const FILE = 'config/initializers/aws.rb';

const patchAdding = (...added: ReadonlyArray<string>) => ({
  path: FILE,
  patch: [
    `diff --git a/${FILE} b/${FILE}`,
    `--- a/${FILE}`,
    `+++ b/${FILE}`,
    `@@ -1,1 +1,${added.length + 1} @@`,
    ' Aws.config.update(',
    ...added.map(line => `+${line}`),
  ].join('\n'),
});

test('an AWS access key a line gains needs a look on its row, masked, saying to rotate it', () => {
  expect(secretFindings([patchAdding("  access_key_id: 'AKIAIOSFODNN7EXAMPLE',")])).toStrictEqual([
    {
      id: `security:secret:${FILE}#aws-access-key`,
      check: 'security:secret',
      dimension: 'security',
      level: 'look',
      file: FILE,
      line: `${FILE}@head:2`,
      title: `${FILE} adds an AWS access key`,
      detail: 'AKIA…(20 chars). Rotate it: it stays in git history once removed.',
    },
  ]);
});

test.for([' ', '-'])('a key on a line the change keeps or removes (%s) raises nothing', prefix => {
  const patch = patchAdding();
  expect(
    secretFindings([{ ...patch, patch: `${patch.patch}\n${prefix}  AKIAIOSFODNN7EXAMPLE` }]),
  ).toEqual([]);
});

test.for([
  { value: `ghp_${'a1B2'.repeat(9)}`, name: 'github-token', said: 'a GitHub token' },
  { value: `gho_${'a1B2'.repeat(9)}`, name: 'github-token', said: 'a GitHub token' },
  { value: `ghs_${'a1B2'.repeat(9)}`, name: 'github-token', said: 'a GitHub token' },
  { value: `github_pat_${'a1_B'.repeat(20)}`, name: 'github-token', said: 'a GitHub token' },
  { value: 'xoxb-1234567890-abcdefABCDEF', name: 'slack-token', said: 'a Slack token' },
  { value: 'xoxp-1234567890-abcdefABCDEF', name: 'slack-token', said: 'a Slack token' },
  { value: `sk_live_${'4eC39HqLyjWD'.repeat(2)}`, name: 'stripe-key', said: 'a Stripe live key' },
  { value: `rk_live_${'4eC39HqLyjWD'.repeat(2)}`, name: 'stripe-key', said: 'a Stripe live key' },
  {
    value: `AIza${'SyD-9tSrke72PouQMnMX_7'}${'a1b2c3d4e5f6g'}`,
    name: 'google-api-key',
    said: 'a Google API key',
  },
])('$said ($value) a line gains needs a look too', ({ value, name, said }) => {
  expect(
    secretFindings([patchAdding(`  token = "${value}"`)]).map(({ id, title, detail }) => ({
      id,
      title,
      detail,
    })),
  ).toStrictEqual([
    {
      id: `security:secret:${FILE}#${name}`,
      title: `${FILE} adds ${said}`,
      detail: `${value.slice(0, 4)}…(${value.length} chars). Rotate it: it stays in git history once removed.`,
    },
  ]);
});

test.for([
  `sk_${'test'}_${'4eC39HqLyjWD'.repeat(2)}`,
  'xoxq-1234567890-abcdef',
  `ghx_${'a1B2'.repeat(9)}`,
  `ghp_${'a1B2'.repeat(4)}`,
  'github_pat_xxxx',
  'xoxb-xxxx',
  'sk_live_xxxx',
])('%s, a test key, another prefix or a placeholder too short for a key, raises nothing', value => {
  expect(secretFindings([patchAdding(`  token = "${value}"`)])).toEqual([]);
});
