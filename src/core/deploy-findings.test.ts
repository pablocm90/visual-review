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

test.for([
  `ENV['STRIPE_KEY']`,
  'ENV.fetch("STRIPE_KEY")',
  `ENV.fetch('STRIPE_KEY', nil)`,
  'ENV.key?("STRIPE_KEY")',
  'process.env.STRIPE_KEY',
  'process.env["STRIPE_KEY"]',
  'import.meta.env.STRIPE_KEY',
  'env::var("STRIPE_KEY")',
  'std::env::var_os("STRIPE_KEY")',
  'env!("STRIPE_KEY")',
  'option_env!("STRIPE_KEY")',
])('reading the key as %s raises it too', read => {
  expect(
    deployKeyFindings([patchAdding(`  config.api_key = ${read}`)]).map(({ id }) => id),
  ).toStrictEqual(['deploy:env:STRIPE_KEY']);
});

test.for([
  { reason: 'a key on a line the change keeps', prefix: ' ', code: 'ENV["STRIPE_KEY"]' },
  { reason: 'a key on a line the change removes', prefix: '-', code: 'ENV["STRIPE_KEY"]' },
  { reason: 'a hash merely named like ENV', prefix: '+', code: 'MY_ENV["STRIPE_KEY"]' },
])('$reason raises nothing', ({ prefix, code }) => {
  const patch = patchAdding();
  expect(deployKeyFindings([{ ...patch, patch: `${patch.patch}\n${prefix}  ${code}` }])).toEqual(
    [],
  );
});
