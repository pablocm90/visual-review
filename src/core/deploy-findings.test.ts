import { expect, test } from 'vitest';
import { deployKeyFindings } from './deploy-findings.ts';
import type { FilePatch } from './diff-graphs.ts';

const deployKeys = (patches: ReadonlyArray<FilePatch>) =>
  deployKeyFindings({ patches, keysAtBase: [] });

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
  expect(deployKeys([patchAdding('  config.api_key = ENV["STRIPE_KEY"]')])).toStrictEqual([
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
  expect(deployKeys([patchAdding(`  config.api_key = ${read}`)]).map(({ id }) => id)).toStrictEqual(
    ['deploy:env:STRIPE_KEY'],
  );
});

test.for([
  { reason: 'a key on a line the change keeps', prefix: ' ', code: 'ENV["STRIPE_KEY"]' },
  { reason: 'a key on a line the change removes', prefix: '-', code: 'ENV["STRIPE_KEY"]' },
  { reason: 'a hash merely named like ENV', prefix: '+', code: 'MY_ENV["STRIPE_KEY"]' },
  {
    reason: 'a method merely named like credentials',
    prefix: '+',
    code: 'aws_credentials.access_key',
  },
])('$reason raises nothing', ({ prefix, code }) => {
  const patch = patchAdding();
  expect(deployKeys([{ ...patch, patch: `${patch.patch}\n${prefix}  ${code}` }])).toEqual([]);
});

test('a key read on several rows and files raises once, on its first row', () => {
  const other = { ...patchAdding('ENV["STRIPE_KEY"]'), path: 'app/jobs/charge.rb' };
  expect(
    deployKeys([
      patchAdding('  config.api_key = ENV["STRIPE_KEY"]', '  config.key = ENV.fetch("STRIPE_KEY")'),
      other,
    ]).map(({ file, line }) => ({ file, line })),
  ).toStrictEqual([{ file: FILE, line: `${FILE}@head:2` }]);
});

test('a key read in a test file is for information', () => {
  const inTest = { ...patchAdding('ENV["STRIPE_KEY"]'), path: 'spec/stripe_spec.rb' };
  expect(deployKeys([inTest]).map(({ level }) => level)).toStrictEqual(['info']);
});

test.for([
  { read: 'Rails.application.credentials.stripe.secret_key', key: 'stripe.secret_key' },
  { read: 'credentials.stripe![:secret_key]', key: 'stripe.secret_key' },
  { read: 'credentials[:stripe][:secret_key]', key: 'stripe.secret_key' },
  { read: 'credentials.stripe["secret_key"]', key: 'stripe.secret_key' },
  { read: 'credentials.dig(:stripe, :secret_key)', key: 'stripe.secret_key' },
  { read: 'credentials.fetch(:stripe)', key: 'stripe' },
])('reading credentials as $read raises the path $key', ({ read, key }) => {
  expect(deployKeys([patchAdding(`  config.api_key = ${read}`)])).toMatchObject([
    {
      id: `deploy:credentials:${key}`,
      check: 'deploy:credentials',
      title: `${FILE} reads the credentials key ${key}`,
    },
  ]);
});

test('a key the base already reads somewhere is no new key', () => {
  expect(
    deployKeyFindings({
      patches: [
        patchAdding('  config.api_key = ENV["STRIPE_KEY"]', '  config.id = ENV["STRIPE_ID"]'),
      ],
      keysAtBase: ['STRIPE_KEY'],
    }).map(({ id }) => id),
  ).toStrictEqual(['deploy:env:STRIPE_ID']);
});
