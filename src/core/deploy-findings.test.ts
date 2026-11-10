import { expect, test } from 'vitest';
import {
  deployFlagFindings,
  deployKeyFindings,
  deployKeysNotRead,
  FLIPPER_FLAGS,
} from './deploy-findings.ts';
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

test.for([
  { read: 'ENV[name]', lines: [`${FILE}:2 reads an env key through a variable`] },
  { read: 'ENV.fetch(name, nil)', lines: [`${FILE}:2 reads an env key through a variable`] },
  { read: 'ENV.key?(name)', lines: [`${FILE}:2 reads an env key through a variable`] },
  { read: 'process.env[name]', lines: [`${FILE}:2 reads an env key through a variable`] },
  { read: 'import.meta.env[name]', lines: [`${FILE}:2 reads an env key through a variable`] },
  { read: 'env::var(&name)', lines: [`${FILE}:2 reads an env key through a variable`] },
  { read: 'env::var_os(&name)', lines: [`${FILE}:2 reads an env key through a variable`] },
  { read: 'ENV["STRIPE_KEY"]', lines: [] },
  { read: 'process.env["STRIPE_KEY"]', lines: [] },
  { read: 'env::var("STRIPE_KEY")', lines: [] },
  { read: 'MY_ENV[name]', lines: [] },
])('reading a key as $read leaves unread $lines', ({ read, lines }) => {
  expect(deployKeysNotRead([patchAdding(`  config.api_key = ${read}`)])).toStrictEqual(lines);
});

test('a key read through a variable on a line the change keeps leaves nothing unread', () => {
  const patch = patchAdding();
  expect(deployKeysNotRead([{ ...patch, patch: `${patch.patch}\n   x = ENV[name]` }])).toEqual([]);
});

const patchChanging = ({
  removed,
  added,
}: {
  readonly removed: ReadonlyArray<string>;
  readonly added: ReadonlyArray<string>;
}) => ({
  path: FILE,
  patch: [
    `diff --git a/${FILE} b/${FILE}`,
    `--- a/${FILE}`,
    `+++ b/${FILE}`,
    `@@ -1,${removed.length + 1} +1,${added.length + 1} @@`,
    ' def charge',
    ...removed.map(line => `-${line}`),
    ...added.map(line => `+${line}`),
  ].join('\n'),
});

const flagsOf = (change: Parameters<typeof patchChanging>[0], flags = FLIPPER_FLAGS) =>
  deployFlagFindings({ patches: [patchChanging(change)], flags });

test('a flag the change starts reading is for information, on its first added row', () => {
  expect(
    flagsOf({ removed: [], added: ['  return unless Flipper.enabled?(:new_checkout, user)'] }),
  ).toStrictEqual([
    {
      id: 'deploy:flag-added:new_checkout',
      check: 'deploy:flag-added',
      dimension: 'deploy',
      level: 'info',
      file: FILE,
      line: `${FILE}@head:2`,
      title: `${FILE} reads the flag new_checkout`,
      detail: 'Check it is set as this needs wherever this deploys.',
    },
  ]);
});

test('a flag the change stops reading is for information, on its first removed row', () => {
  expect(
    flagsOf({ removed: ['  return unless Flipper.enabled?(:old_checkout)'], added: [] }),
  ).toStrictEqual([
    {
      id: 'deploy:flag-removed:old_checkout',
      check: 'deploy:flag-removed',
      dimension: 'deploy',
      level: 'info',
      file: FILE,
      line: `${FILE}@base:2`,
      title: `${FILE} no longer reads the flag old_checkout`,
      detail: 'Check nothing still reads it before deleting it.',
    },
  ]);
});

test.for([
  {
    reason: 'a line rewritten around the flag',
    removed: ['if Flipper.enabled?(:x)'],
    added: ['if Flipper.enabled?(:x) && ok'],
    ids: [],
  },
  {
    reason: 'a second read of a flag',
    removed: [],
    added: ['Flipper.enabled?(:x)', 'Flipper.enabled?(:x)'],
    ids: ['deploy:flag-added:x'],
  },
  {
    reason: 'one of two reads removed',
    removed: ['Flipper.enabled?(:x)', 'Flipper.enabled?(:x)'],
    added: ['Flipper.enabled?(:x)'],
    ids: ['deploy:flag-removed:x'],
  },
  {
    reason: 'one read gained over one kept',
    removed: ['Flipper.enabled?(:x)'],
    added: ['Flipper.enabled?(:x)', 'Flipper.enable :x'],
    ids: ['deploy:flag-added:x'],
  },
])('$reason raises $ids', ({ removed, added, ids }) => {
  expect(flagsOf({ removed, added }).map(({ id }) => id)).toStrictEqual(ids);
});

test.for([
  'Flipper.enabled?(:x)',
  'Flipper.enabled? :x',
  'Flipper.enabled?("x")',
  `Flipper.enable('x')`,
  'Flipper[:x].enabled?',
  '::Flipper.enabled?(:x)',
  'Flipper.enabled?( :x )',
  'Flipper.disable(:x)',
])('reading the flag as %s raises it', read => {
  expect(flagsOf({ removed: [], added: [read] }).map(({ id }) => id)).toStrictEqual([
    'deploy:flag-added:x',
  ]);
});

test.for([
  'MyFlipper.enabled?(:x)',
  'flipper.enabled?(:x)',
  'Flipper.enabled_for?(:x)',
  'Flipper.enabled?(name)',
])('%s reads no flag', read => {
  expect(flagsOf({ removed: [], added: [read] })).toEqual([]);
});

test('a configured name with a wildcard reads every call it matches', () => {
  expect(
    flagsOf({ removed: [], added: ['features.isEnabled("x") && this.features.isOn?("y")'] }, [
      'features.is*',
    ]).map(({ id }) => id),
  ).toStrictEqual(['deploy:flag-added:x', 'deploy:flag-added:y']);
});

test('no configured name reads no flag', () => {
  expect(flagsOf({ removed: [], added: ['Flipper.enabled?(:x)'] }, [])).toEqual([]);
});

test.for([
  { path: 'CHANGELOG.md', ids: [] },
  { path: 'config/storage.yml', ids: [] },
  { path: 'app/views/charges/new.html.erb', ids: ['deploy:env:STRIPE_KEY', 'deploy:flag-added:x'] },
  { path: 'web/src/pay.tsx', ids: ['deploy:env:STRIPE_KEY', 'deploy:flag-added:x'] },
  { path: 'web/src/pay.mjs', ids: ['deploy:env:STRIPE_KEY', 'deploy:flag-added:x'] },
  { path: 'api/src/main.rs', ids: ['deploy:env:STRIPE_KEY', 'deploy:flag-added:x'] },
])('the code of $path raises $ids', ({ path, ids }) => {
  const patches = [{ ...patchAdding('ENV["STRIPE_KEY"] && Flipper.enabled?(:x)'), path }];
  expect(
    [...deployKeys(patches), ...deployFlagFindings({ patches, flags: FLIPPER_FLAGS })].map(
      ({ id }) => id,
    ),
  ).toStrictEqual(ids);
});

test('a key read through a variable outside code leaves nothing unread', () => {
  expect(deployKeysNotRead([{ ...patchAdding('ENV[name]'), path: 'README.md' }])).toEqual([]);
});
