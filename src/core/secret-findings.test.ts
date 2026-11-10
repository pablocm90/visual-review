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
  expect(secretFindings([patchAdding(`  value = "${value}"`)])).toEqual([]);
});

test.for(['RSA ', 'EC ', 'OPENSSH ', ''])(
  'a %sPRIVATE KEY header a line gains needs a look, its header shown',
  kind => {
    const header = `-----BEGIN ${kind}PRIVATE KEY-----`;
    expect(
      secretFindings([patchAdding(header, 'MIIEowIBAAKCAQEA0Z3VS5JJcds3xfn')]).map(
        ({ id, line, title, detail }) => ({ id, line, title, detail }),
      ),
    ).toStrictEqual([
      {
        id: `security:secret:${FILE}#private-key`,
        line: `${FILE}@head:2`,
        title: `${FILE} adds a private key`,
        detail: `${header}. Rotate it: it stays in git history once removed.`,
      },
    ]);
  },
);

const HEURISTIC =
  'heuristic: a long, varied literal under a secret-like name. Rotate it: it stays in git history once removed.';

test.for([
  { code: '  api_key = "aB3dE5fG7hJ9kL1mN0pQ"', name: 'api_key' },
  { code: "  password: 'aB3dE5fG7hJ9kL1mN0pQ',", name: 'password' },
  { code: '  "client_secret" => "aB3dE5fG7hJ9kL1mN0pQ",', name: 'client_secret' },
  { code: "SECRET_TOKEN = 'aB3dE5fG7hJ9kL1mN0pQ'", name: 'SECRET_TOKEN' },
  { code: "export const apiKey = 'aB3dE5fG7hJ9kL1mN0pQ';", name: 'apiKey' },
])('a varied literal a line gains under $name needs a look, by heuristic', ({ code, name }) => {
  expect(
    secretFindings([patchAdding(code)]).map(({ id, title, detail }) => ({ id, title, detail })),
  ).toStrictEqual([
    {
      id: `security:secret:${FILE}#assigned-secret`,
      title: `${FILE} adds a secret-like value for ${name}`,
      detail: `aB3d…(20 chars), ${HEURISTIC}`,
    },
  ]);
});

test.for([
  { code: '  password = "your-api-key-here"', why: 'a placeholder, little varied' },
  { code: '  token = "aB3dE5fG7hJ9kL1"', why: 'shorter than 16 characters' },
  { code: '  token = ENV["API_TOKEN_FOR_THE_APP"]', why: 'no literal assigned' },
  { code: '  if token == "aB3dE5fG7hJ9kL1mN0pQ"', why: 'compared, not assigned' },
  { code: '  name = "aB3dE5fG7hJ9kL1mN0pQ"', why: 'under a name holding no secret word' },
  { code: '  password_hint: "Use twelve characters, one digit"', why: 'words, not a key' },
])('$code raises nothing: $why', ({ code }) => {
  expect(secretFindings([patchAdding(code)])).toEqual([]);
});

const addedFile = (path: string) => ({
  path,
  patch: [
    `diff --git a/${path} b/${path}`,
    'new file mode 100644',
    'index 0000000..e69de29',
    '--- /dev/null',
    `+++ b/${path}`,
    '@@ -0,0 +1,1 @@',
    '+# nothing to see',
  ].join('\n'),
});

test.for([
  '.env',
  '.env.production',
  'web/.env.local',
  'config/master.key',
  'backend/config/master.key',
  'config/credentials/production.key',
  'certs/server.pem',
  'id_rsa',
  'deploy/id_rsa_ci',
])('%s, a secret file the change adds, needs a look', path => {
  expect(secretFindings([addedFile(path)])).toStrictEqual([
    {
      id: `security:secret:${path}#secret-file`,
      check: 'security:secret',
      dimension: 'security',
      level: 'look',
      file: path,
      title: `${path} is a secret file the change adds`,
      detail: 'Keep it out of git and rotate what it holds: it stays in git history once removed.',
    },
  ]);
});

test.for([
  '.env.example',
  'deploy/id_rsa.pub',
  'config/credentials.yml.enc',
  'config/credentials/production.yml.enc',
  'app/models/master.key.rb',
  'docs/env.md',
  'lib/letter.envelope.rb',
  'deploy/.environments/README.md',
  'docs/id_rsa/README.md',
])('%s, a file the change adds that holds no secret, raises nothing', path => {
  expect(secretFindings([addedFile(path)])).toEqual([]);
});

test('a secret file the change edits, not adds, raises nothing for the file', () => {
  expect(secretFindings([{ ...patchAdding('new file mode 100644'), path: '.env' }])).toEqual([]);
});

const AWS = 'AKIAIOSFODNN7EXAMPLE';

test.for([
  'pnpm-lock.yaml',
  'web/package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'Gemfile.lock',
  'Cargo.lock',
  'api/poetry.lock',
])('%s, a lockfile, is not scanned: its hashes would read as keys', path => {
  expect(
    secretFindings([{ ...patchAdding(`  token: "aB3dE5fG7hJ9kL1mN0pQ" ${AWS}`), path }]),
  ).toEqual([]);
});

test.for(['lock.rb', 'bin/unlock', 'app/services/redis.lock.rb', 'config/lockfile.yml'])(
  '%s, named like a lock but no lockfile, is scanned',
  path => {
    expect(secretFindings([{ ...patchAdding(AWS), path }]).map(({ id }) => id)).toStrictEqual([
      `security:secret:${path}#aws-access-key`,
    ]);
  },
);
