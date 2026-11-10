import { expect, test } from 'vitest';
import { secretFindings, secretValues } from './secret-findings.ts';

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

test('every key of a format a line gains raises and is masked, not only its first', () => {
  const other = 'AKIAJ7Q2EXAMPLEKEY99';
  const twice = patchAdding(`  keys: ['${AWS}', '${other}']`);
  expect(secretFindings([twice]).map(({ id }) => id)).toStrictEqual([
    `security:secret:${FILE}#aws-access-key`,
    `security:secret:${FILE}#aws-access-key#2`,
  ]);
  expect(secretValues([twice])).toStrictEqual([AWS, other]);
});

test('every secret-like value a line gains under a secret-like name raises and is masked', () => {
  const twice = patchAdding('  token: "aB3dE5fG7hJ9kL1mN0pQ", api_key: "Zx8Yw7Vu6Ts5Rq4Po3Nm"');
  expect(secretValues([twice])).toStrictEqual(['aB3dE5fG7hJ9kL1mN0pQ', 'Zx8Yw7Vu6Ts5Rq4Po3Nm']);
});

test.for([
  'pnpm-lock.yaml',
  'web/package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'Gemfile.lock',
  'Cargo.lock',
  'api/poetry.lock',
])(
  '%s, a lockfile, is not read by heuristic, its hashes reading as keys, but known keys still raise',
  path => {
    expect(
      secretFindings([
        { ...patchAdding('  token: "aB3dE5fG7hJ9kL1mN0pQ"', `  key: ${AWS}`), path },
      ]).map(({ id }) => id),
    ).toStrictEqual([`security:secret:${path}#aws-access-key`]);
  },
);

test.for(['lock.rb', 'bin/unlock', 'app/services/redis.lock.rb', 'config/lockfile.yml'])(
  '%s, named like a lock but no lockfile, is read by heuristic too',
  path => {
    expect(
      secretFindings([{ ...patchAdding('  token: "aB3dE5fG7hJ9kL1mN0pQ"'), path }]).map(
        ({ id }) => id,
      ),
    ).toStrictEqual([`security:secret:${path}#assigned-secret`]);
  },
);

test.for([
  'spec/fixtures/aws.yml',
  'test/fixtures/files/keys.txt',
  'web/src/__tests__/client.ts',
  'web/src/client.test.ts',
  'web/src/client.spec.tsx',
  'test/models/user_test.rb',
  'spec/models/user_spec.rb',
  'crates/api/tests/keys.rs',
  'fixtures/keys.json',
  'spec/support/keys.rb',
  'pkg/client_test.go',
])('a secret in %s, a test file or fixture, is for information', path => {
  expect(
    secretFindings([{ ...patchAdding(AWS), path }, addedFile(`${path}.pem`)]).map(
      ({ level }) => level,
    ),
  ).toStrictEqual(['info', 'info']);
});

test.for([
  'app/models/contest.rb',
  'app/contests/entry.rb',
  'web/src/testing.ts',
  'lib/load_testing.rb',
  'lib/specs.rb',
  'web/src/latest.ts',
])('a secret in %s, no test file, needs a look', path => {
  expect(
    secretFindings([{ ...patchAdding(AWS), path }, addedFile(`${path}.pem`)]).map(
      ({ level }) => level,
    ),
  ).toStrictEqual(['look', 'look']);
});

test('the values a change adds that raise a finding are known, to mask them, whatever level they raise at', () => {
  expect(
    secretValues([
      patchAdding(
        `  key: ${AWS}`,
        '  token: "aB3dE5fG7hJ9kL1mN0pQ"',
        '  name: "plain"',
        '-----BEGIN RSA PRIVATE KEY-----',
      ),
      { ...patchAdding(`  stripe: "sk_live_${'4eC39HqLyjWD'.repeat(2)}"`), path: 'spec/keys.rb' },
    ]),
  ).toStrictEqual([AWS, 'aB3dE5fG7hJ9kL1mN0pQ', `sk_live_${'4eC39HqLyjWD'.repeat(2)}`]);
});

test('the body lines of a private key a change adds are values to mask, up to its footer, a blank one aside', () => {
  expect(
    secretValues([
      patchAdding(
        'key = <<~PEM',
        '  -----BEGIN OPENSSH PRIVATE KEY-----',
        '  b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW',
        '',
        '  QyNTUxOQAAACBhc2RmYXNkZmFzZGZhc2RmYXNkZmFzZGZhc2RmYXNkZgAAAJgAAAAA',
        '  -----END OPENSSH PRIVATE KEY-----',
        'PEM',
      ),
    ]),
  ).toStrictEqual([
    'b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW',
    'QyNTUxOQAAACBhc2RmYXNkZmFzZGZhc2RmYXNkZmFzZGZhc2RmYXNkZgAAAJgAAAAA',
  ]);
});

test("a private key's body line is a value to mask only when it reads as base64 of 16 characters or more, so no code line or short line is masked page-wide", () => {
  expect(
    secretValues([
      patchAdding(
        '-----BEGIN RSA PRIVATE KEY-----',
        'AAAA+BBB/CCCDDDD',
        'AAAABBBBCCCCDDD',
        'verifyAuthorizedAccess(user) unless currentUserIsAdmin',
        'Zm9vYmFyYmF6cXV4cXV1eA==',
        '-----END RSA PRIVATE KEY-----',
      ),
    ]),
  ).toStrictEqual(['AAAA+BBB/CCCDDDD', 'Zm9vYmFyYmF6cXV4cXV1eA==']);
});
