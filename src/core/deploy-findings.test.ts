import { expect, test } from 'vitest';
import { deployKeyFindings } from './deploy-findings.ts';

const FILE = 'config/initializers/stripe.rb';

const patchAdding = (...added: ReadonlyArray<string>) => ({
  path: FILE,
  patch: [
    `diff --git a/${FILE} b/${FILE}`,
    `--- a/${FILE}`,
    `+++ b/${FILE}`,
    `@@ -1,1 +1,${added.length + 1} @@`,
    ' Stripe.configure do |config|',
    ...added.map(line => `+${line}`),
  ].join('\n'),
});

test('an env key a line gains needs a look on its row, to be set before the deploy', () => {
  expect(deployKeyFindings([patchAdding('  config.api_key = ENV["STRIPE_KEY"]')])).toStrictEqual([
    {
      id: 'deploy:env:STRIPE_KEY',
      check: 'deploy:env',
      dimension: 'deploy',
      level: 'look',
      file: FILE,
      line: `${FILE}@head:2`,
      title: `${FILE} reads the env key STRIPE_KEY`,
      detail: 'Set it in every environment before this deploys.',
    },
  ]);
});
