import { expect, test } from 'vitest';
import { fakeReader } from '../test-support/fakes.ts';
import { readRange } from '../test-support/read-range.ts';
import { commit, crateFiles, git, gitRepo, writeFiles } from '../test-support/repos.ts';

const nodeIds = (graph: { readonly nodes: ReadonlyArray<{ readonly id: string }> }) =>
  graph.nodes.map(node => node.id);

test.for([
  { reason: 'an unknown key', text: '{"stack": {}}', error: 'Unrecognized key: "stack"' },
  { reason: 'no JSON', text: '{"stacks": ', error: 'SyntaxError: Unexpected end of JSON input' },
  {
    reason: 'an unknown key in a stack',
    text: '{"stacks": {"web": {"boxs": []}}}',
    error: 'stacks.web: Unrecognized key: "boxs"',
  },
  {
    reason: 'a reader without a root',
    text: '{"stacks": {"gen": {"reader": "typescript"}}}',
    error: 'stacks.gen: give both reader and root, or neither',
  },
  {
    reason: 'a root without a reader',
    text: '{"stacks": {"gen": {"root": "tools/gen"}}}',
    error: 'stacks.gen: give both reader and root, or neither',
  },
  {
    reason: 'a stack field of the wrong type',
    text: '{"stacks": {"web": {"boxes": "modules/*"}}}',
    error: 'stacks.web.boxes: Invalid input: expected array, received string',
  },
  {
    reason: 'a root outside the repo',
    text: '{"stacks": {"gen": {"reader": "rust", "root": "tools/../.."}}}',
    error: 'stacks.gen.root: must be a folder inside the repo',
  },
  {
    reason: "a source root outside the stack's root",
    text: '{"stacks": {"web": {"sourceRoot": "lib/../../shared"}}}',
    error: "stacks.web.sourceRoot: must be a folder inside the stack's root",
  },
  {
    reason: 'an absolute root',
    text: '{"stacks": {"gen": {"reader": "rust", "root": "/tools/gen"}}}',
    error: 'stacks.gen.root: must be a folder inside the repo',
  },
  {
    reason: 'an absolute source root',
    text: '{"stacks": {"web": {"sourceRoot": "/shared"}}}',
    error: "stacks.web.sourceRoot: must be a folder inside the stack's root",
  },
  {
    reason: 'an unknown linker',
    text: '{"linkers": {"fetch-axe": false}}',
    error: 'linkers: Unrecognized key: "fetch-axe"',
  },
  {
    reason: 'an unknown key in a linker',
    text: '{"linkers": {"fetch-axum": {"form": ["web"]}}}',
    error: 'linkers.fetch-axum: Unrecognized key: "form"',
  },
  {
    reason: 'an unknown key in metrics',
    text: '{"metrics": {"churn": 30}}',
    error: 'metrics: Unrecognized key: "churn"',
  },
  {
    reason: 'a churn window of no days',
    text: '{"metrics": {"churnDays": 0}}',
    error: 'metrics.churnDays: Too small: expected number to be >0',
  },
  {
    reason: 'a churn window in part days',
    text: '{"metrics": {"churnDays": 1.5}}',
    error: 'metrics.churnDays: Invalid input: expected int, received number',
  },
  {
    reason: 'a cyclomatic threshold of 0',
    text: '{"metrics": {"cyclomatic": 0}}',
    error: 'metrics.cyclomatic: Too small: expected number to be >0',
  },
  {
    reason: 'a cyclomatic threshold in part',
    text: '{"metrics": {"cyclomatic": 1.5}}',
    error: 'metrics.cyclomatic: Invalid input: expected int, received number',
  },
  {
    reason: 'an unknown key in the hotspot',
    text: '{"metrics": {"hotspot": {"churnDays": 6}}}',
    error: 'metrics.hotspot: Unrecognized key: "churnDays"',
  },
  {
    reason: 'a hotspot churn in part',
    text: '{"metrics": {"hotspot": {"churn": 1.5}}}',
    error: 'metrics.hotspot.churn: Invalid input: expected int, received number',
  },
  {
    reason: 'a hotspot cyclomatic of 0',
    text: '{"metrics": {"hotspot": {"cyclomatic": 0}}}',
    error: 'metrics.hotspot.cyclomatic: Too small: expected number to be >0',
  },
  {
    reason: 'a lines threshold of 0',
    text: '{"metrics": {"lines": 0}}',
    error: 'metrics.lines: Too small: expected number to be >0',
  },
  {
    reason: 'an ABC threshold of 0',
    text: '{"metrics": {"abc": 0}}',
    error: 'metrics.abc: Too small: expected number to be >0',
  },
  {
    reason: 'a rule with no reason',
    text: '{"rules": {"no-billing": {"from": "shop/**", "notTo": "shop/layer/models/billing"}}}',
    error: 'rules.no-billing.reason: Invalid input: expected string, received undefined',
  },
  {
    reason: 'an unknown key in a rule',
    text: '{"rules": {"no-billing": {"from": "shop/**", "to": "shop/billing", "reason": "x"}}}',
    error: 'rules.no-billing: Unrecognized key: "to"',
  },
  {
    reason: 'a rule whose from is neither a glob nor a list of them',
    text: '{"rules": {"no-billing": {"from": 3, "notTo": "shop/billing", "reason": "x"}}}',
    error: 'rules.no-billing.from: Invalid input: expected a glob or a list of globs',
  },
  {
    reason: 'a rule whose notTo is an empty list',
    text: '{"rules": {"no-billing": {"from": "shop/**", "notTo": [], "reason": "x"}}}',
    error: 'rules.no-billing.notTo: Too small: expected array to have >=1 items',
  },
  {
    reason: 'an unknown key in notes',
    text: '{"notes": {"guidence": "Name the port."}}',
    error: 'notes: Unrecognized key: "guidence"',
  },
  {
    reason: 'a notes guidance that is no text',
    text: '{"notes": {"guidance": ["Name the port."]}}',
    error: 'notes.guidance: Invalid input: expected string, received array',
  },
  {
    reason: 'a notes switch that is no boolean',
    text: '{"notes": {"why": "no"}}',
    error: 'notes.why: Invalid input: expected boolean, received string',
  },
  {
    reason: 'a stack neither false nor an object',
    text: '{"stacks": {"web": true}}',
    error: 'stacks.web: Invalid input: expected false or an object',
  },
])(
  'a config with $reason fails the review, naming the file and the problem',
  async ({ text, error }) => {
    using workspace = gitRepo({ 'package.json': '{}\n', 'src/index.ts': '' });
    const { repo, root } = workspace;
    const to = commit(repo, { 'visual-review.config.json': text });

    await expect(readRange({ repo, from: root, to })).rejects.toThrow(
      `visual-review.config.json: ${error}`,
    );
  },
);

test("the box globs the head revision's config gives a stack, by its drawn id, shape its boxes on both sides, whatever the working tree holds", async () => {
  using workspace = gitRepo({
    'package.json': '{"name": "app"}\n',
    'src/modules/AppInfo/app-info.ts': '',
    'src/utils/add.ts': '',
  });
  const { repo, root } = workspace;
  const to = commit(repo, {
    'visual-review.config.json': '{"stacks": {"app": {"boxes": ["modules/*"]}}}\n',
  });
  git(repo, 'checkout', '--quiet', root);

  const range = await readRange({ repo, from: root, to });

  const boxed = [
    expect.objectContaining({ id: 'app' }),
    expect.objectContaining({ id: 'app/module/modules/AppInfo', label: 'modules/AppInfo' }),
    expect.objectContaining({ id: 'app/file/modules/AppInfo/app-info.ts' }),
    expect.objectContaining({ id: 'app/module/utils' }),
    expect.objectContaining({ id: 'app/file/utils/add.ts' }),
  ];
  expect(range.before.nodes).toEqual(boxed);
  expect(range.after.nodes).toEqual(boxed);
});

test('a config may name a stack detected only on the base side', async () => {
  using workspace = gitRepo({ 'old/package.json': '{}\n', 'old/src/a.ts': '' });
  const { repo, root } = workspace;
  git(repo, 'rm', '--quiet', '-r', 'old');
  const to = commit(repo, {
    'visual-review.config.json': '{"stacks": {"old": {"label": "Old"}}}\n',
  });

  const range = await readRange({ repo, from: root, to });

  expect(range.before.nodes).toContainEqual(expect.objectContaining({ id: 'old', label: 'Old' }));
});

test('a config stack with a reader and a root adds that stack where the root exists, package.json or not', async () => {
  using workspace = gitRepo({ 'README.md': '' });
  const { repo, root } = workspace;
  const to = commit(repo, {
    'tools/gen/src/index.ts': '',
    'visual-review.config.json':
      '{"stacks": {"gen": {"reader": "typescript", "root": "tools/gen"}}}\n',
  });

  const range = await readRange({ repo, from: root, to });

  expect(nodeIds(range.before)).toEqual([]);
  expect(range.after.nodes).toEqual([
    expect.objectContaining({ id: 'gen', label: 'gen' }),
    expect.objectContaining({ id: 'gen/file/index.ts', path: 'tools/gen/src/index.ts' }),
  ]);
});

test('a Rust stack added at a root reads the Cargo workspace there where it exists, under its own id and with repo paths, and the TS reader leaves it alone', async () => {
  using workspace = gitRepo({ 'README.md': '' });
  const { repo, root } = workspace;
  const to = commit(repo, {
    'backend/Cargo.toml': '[workspace]\nmembers = ["crates/*"]\nresolver = "2"\n',
    ...Object.fromEntries(
      Object.entries(crateFiles('core')).map(([path, text]) => [`backend/${path}`, text]),
    ),
    'backend/src/tool.ts': '',
    'visual-review.config.json': '{"stacks": {"api": {"reader": "rust", "root": "backend"}}}\n',
  });

  const range = await readRange({ repo, from: root, to });

  expect(nodeIds(range.before)).toEqual([]);
  expect(range.after.nodes).toEqual([
    expect.objectContaining({ id: 'api', label: 'api', path: '' }),
    expect.objectContaining({ id: 'api/crate/core', parent: 'api', path: 'backend/crates/core' }),
    expect.objectContaining({
      id: 'api/mod/core/lib.rs',
      parent: 'api/crate/core',
      path: 'backend/crates/core/src/lib.rs',
    }),
  ]);
});

test('a Rust stack added at a root whose manifest is a package draws that crate at the root', async () => {
  using workspace = gitRepo({ 'README.md': '' });
  const { repo, root } = workspace;
  const to = commit(repo, {
    'tools/x/Cargo.toml': '[package]\nname = "tx"\nversion = "0.1.0"\nedition = "2021"\n',
    'tools/x/src/lib.rs': '',
    'visual-review.config.json': '{"stacks": {"tx": {"reader": "rust", "root": "tools/x"}}}\n',
  });

  const range = await readRange({ repo, from: root, to });

  expect(range.after.nodes).toContainEqual(
    expect.objectContaining({ id: 'tx/crate/tx', path: 'tools/x' }),
  );
});

test.for(['lib', './lib/'])(
  "a TS stack's source root from the config, here %s, replaces the one guessed",
  async sourceRoot => {
    using workspace = gitRepo({
      'web/package.json': '{}\n',
      'web/src/a.ts': '',
      'web/lib/b.ts': '',
      'visual-review.config.json': JSON.stringify({ stacks: { web: { sourceRoot } } }),
    });
    const { repo, root } = workspace;

    const range = await readRange({ repo, from: root, to: root });

    expect(range.after.nodes).toEqual([
      expect.objectContaining({ id: 'web' }),
      expect.objectContaining({ id: 'web/file/b.ts', path: 'web/lib/b.ts' }),
    ]);
  },
);

test('a TS stack added by the config reads the source root the config gives it', async () => {
  using workspace = gitRepo({
    'tools/gen/lib/a.ts': '',
    'visual-review.config.json':
      '{"stacks": {"gen": {"reader": "typescript", "root": "tools/gen", "sourceRoot": "lib"}}}',
  });
  const { repo, root } = workspace;

  const range = await readRange({ repo, from: root, to: root });

  expect(range.after.nodes).toEqual([
    expect.objectContaining({ id: 'gen' }),
    expect.objectContaining({ id: 'gen/file/a.ts', path: 'tools/gen/lib/a.ts' }),
  ]);
});

test.for([
  {
    reason: 'a package directory',
    stack: 'web',
    manifest: 'web/package.json',
    file: 'web/app/a.ts',
  },
  {
    reason: 'the root package, by its name',
    stack: 'site',
    manifest: 'package.json',
    file: 'app/a.ts',
  },
])(
  'a package whose only sources sit under the source root its config gives, here $reason, is detected as a stack',
  async ({ stack, manifest, file }) => {
    using workspace = gitRepo({
      [manifest]: '{"name": "site"}\n',
      [file]: '',
      'visual-review.config.json': JSON.stringify({ stacks: { [stack]: { sourceRoot: 'app' } } }),
    });
    const { repo, root } = workspace;

    const range = await readRange({ repo, from: root, to: root });

    expect(range.after.nodes).toEqual([
      expect.objectContaining({ id: stack }),
      expect.objectContaining({ id: `${stack}/file/a.ts`, path: file }),
    ]);
  },
);

test('a package drawn under a suffix is detected by the source root its config gives under that suffixed id', async () => {
  using workspace = gitRepo({
    'package.json': '{ "name": "web" }\n',
    'src/a.ts': '',
    'web/package.json': '{}\n',
    'web/app/b.ts': '',
    'visual-review.config.json': '{"stacks": {"web~2": {"sourceRoot": "app"}}}',
  });
  const { repo, root } = workspace;

  const range = await readRange({ repo, from: root, to: root });

  expect(nodeIds(range.after)).toEqual(['web', 'web/file/a.ts', 'web~2', 'web~2/file/b.ts']);
});

test.for([
  { reason: 'no root', reader: 'rust', files: {} },
  {
    reason: 'a root without its source folder',
    reader: 'typescript',
    files: { 'tools/gen/index.ts': '' },
  },
  {
    reason: 'a root without config/application.rb',
    reader: 'rails',
    files: { 'tools/gen/app/models/order.rb': '' },
  },
])(
  'a config stack added at a root that holds it on neither side, here $reason, fails the review, naming the root',
  async ({ reader, files }) => {
    using workspace = gitRepo({ 'README.md': '' });
    const { repo, root } = workspace;
    const to = commit(repo, {
      ...files,
      'visual-review.config.json': JSON.stringify({
        stacks: { gen: { reader, root: 'tools/gen' } },
      }),
    });

    await expect(readRange({ repo, from: root, to })).rejects.toThrow(
      new Error(
        `visual-review.config.json: stacks.gen.root: tools/gen holds no ${reader} stack on either side`,
      ),
    );
  },
);

test('a config may point its $schema at the published schema', async () => {
  using workspace = gitRepo({ 'web/package.json': '{}\n', 'web/src/a.ts': '' });
  const { repo, root } = workspace;
  const to = commit(repo, {
    'visual-review.config.json': JSON.stringify({
      $schema: './node_modules/@pablocm90/visual-review/dist/config.schema.json',
      stacks: { web: { label: 'Web' } },
    }),
  });

  const range = await readRange({ repo, from: root, to });

  expect(range.after.nodes).toContainEqual(expect.objectContaining({ id: 'web', label: 'Web' }));
});

test.for([
  { reason: 'plain', mark: '' },
  { reason: 'with a byte order mark', mark: '\uFEFF' },
])(
  "when the head revision has no config, the working tree's, $reason, applies to both sides",
  async ({ mark }) => {
    using workspace = gitRepo({ 'web/package.json': '{}\n', 'web/src/a.ts': '' });
    const { repo, root } = workspace;
    writeFiles(repo, {
      'visual-review.config.json': `${mark}{"stacks": {"web": {"label": "Web"}}}`,
    });

    const range = await readRange({ repo, from: root, to: root });

    const relabelled = expect.objectContaining({ id: 'web', label: 'Web' });
    expect(range.before.nodes).toContainEqual(relabelled);
    expect(range.after.nodes).toContainEqual(relabelled);
  },
);

test("the config's metrics.churnDays sets how many days before each side's commit its churn counts, and is the reading's churn window", async () => {
  using repository = gitRepo({ 'package.json': '{}\n', 'src/a.ts': '' });
  const { repo } = repository;
  commit(repo, { 'src/a.ts': '1' }, { date: '2090-06-01T00:00:00Z' });
  const base = commit(repo, { 'src/a.ts': '2' }, { date: '2090-06-20T00:00:00Z' });
  const head = commit(
    repo,
    { 'src/a.ts': '3', 'visual-review.config.json': '{"metrics": {"churnDays": 15}}' },
    { date: '2090-06-30T00:00:00Z' },
  );

  const range = await readRange({ repo, from: base, to: head });

  expect(range.churn).toEqual({ before: { 'src/a.ts': 1 }, after: { 'src/a.ts': 2 } });
  expect(range.churnDays).toBe(15);
});

test.for([
  {
    reason:
      'are 10 per function, a hotspot at churn 6 and cyclomatic 8 and a split at 4 parts with no config',
    files: {},
    thresholds: { cyclomatic: 10, splitParts: 4, hotspot: { churn: 6, cyclomatic: 8 } },
  },
  {
    reason: "take the config's metrics.cyclomatic when set",
    files: { 'visual-review.config.json': '{"metrics": {"cyclomatic": 4}}' },
    thresholds: { cyclomatic: 4, splitParts: 4, hotspot: { churn: 6, cyclomatic: 8 } },
  },
  {
    reason: "take the config's hotspot churn alone",
    files: { 'visual-review.config.json': '{"metrics": {"hotspot": {"churn": 3}}}' },
    thresholds: { cyclomatic: 10, splitParts: 4, hotspot: { churn: 3, cyclomatic: 8 } },
  },
  {
    reason: "take the config's hotspot cyclomatic alone",
    files: { 'visual-review.config.json': '{"metrics": {"hotspot": {"cyclomatic": 5}}}' },
    thresholds: { cyclomatic: 10, splitParts: 4, hotspot: { churn: 6, cyclomatic: 5 } },
  },
  {
    reason: "take the config's splitParts when set",
    files: { 'visual-review.config.json': '{"metrics": {"splitParts": 3}}' },
    thresholds: { cyclomatic: 10, hotspot: { churn: 6, cyclomatic: 8 }, splitParts: 3 },
  },
  {
    reason: "take the config's lines and abc when set",
    files: { 'visual-review.config.json': '{"metrics": {"lines": 300, "abc": 40.5}}' },
    thresholds: {
      cyclomatic: 10,
      splitParts: 4,
      hotspot: { churn: 6, cyclomatic: 8 },
      lines: 300,
      abc: 40.5,
    },
  },
])("the reading's thresholds $reason", async ({ files, thresholds }) => {
  using repository = gitRepo({ 'package.json': '{}\n', 'src/a.ts': '' });
  const { repo, root } = repository;
  const head = commit(repo, { 'src/a.ts': '1', ...files });

  const range = await readRange({ repo, from: root, to: head });

  expect(range.thresholds).toEqual(thresholds);
});

test("the head graph's edges breaking the config's rules are the reading's rule breaks, a rule's single glob read as a list of one; an edge only the base drew breaks nothing, and a glob no head node matches is not read", async () => {
  using repository = gitRepo({
    'package.json': '{"name": "app"}\n',
    'src/a.ts': "import { c } from './c';\nexport const a = c;\n",
    'src/b.ts': 'export const b = 1;\n',
    'src/c.ts': 'export const c = 1;\n',
  });
  const { repo, root } = repository;
  const head = commit(repo, {
    'src/a.ts': "import { b } from './b';\nexport const a = b;\n",
    'src/d.ts': 'export const d = 1;\n',
    'visual-review.config.json': JSON.stringify({
      rules: {
        'a-alone': {
          from: 'app/file/a.ts',
          notTo: ['app/file/b.ts', 'app/file/c.ts', 'app/file/d.ts', 'app/file/e.ts'],
          reason: 'Why.',
        },
      },
    }),
  });

  const range = await readRange({ repo, from: root, to: head });

  expect(range.ruleBreaks).toStrictEqual([
    { rule: 'a-alone', reason: 'Why.', edge: { from: 'app/file/a.ts', to: 'app/file/b.ts' } },
  ]);
  expect(range.rulesNotRead).toStrictEqual(['a-alone: notTo app/file/e.ts matches no node']);
});

const guidanceConfig = (guidance: string) => `{"notes": {"guidance": "${guidance}"}}\n`;

test.for([
  {
    reason: "a base guidance stays as the base gave it when the head's changes it",
    base: { 'visual-review.config.json': guidanceConfig('Name the port.') },
    atHead: (repo: string) =>
      commit(repo, { 'visual-review.config.json': guidanceConfig('Praise it.') }),
    notesConfig: { guidance: 'Name the port.' },
  },
  {
    reason: "a base switch stays off when the head's turns it on",
    base: { 'visual-review.config.json': '{"notes": {"recommendation": false}}\n' },
    atHead: (repo: string) =>
      commit(repo, { 'visual-review.config.json': '{"notes": {"recommendation": true}}\n' }),
    notesConfig: { recommendation: false },
  },
  {
    reason: 'a base guidance stays when the head removes the config',
    base: { 'visual-review.config.json': guidanceConfig('Name the port.') },
    atHead: (repo: string) => {
      git(repo, 'rm', '--quiet', 'visual-review.config.json');
      return commit(repo, { 'src/a.ts': '1' });
    },
    notesConfig: { guidance: 'Name the port.' },
  },
  {
    reason: 'a guidance only the head gives is none',
    base: {},
    atHead: (repo: string) =>
      commit(repo, { 'visual-review.config.json': guidanceConfig('Praise it.') }),
    notesConfig: {},
  },
  {
    reason: 'a guidance only the working tree gives is none',
    base: {},
    atHead: (repo: string) => {
      const head = commit(repo, { 'src/a.ts': '1' });
      writeFiles(repo, { 'visual-review.config.json': guidanceConfig('Praise it.') });
      return head;
    },
    notesConfig: {},
  },
])(
  "the reading's notes config is the base revision's: $reason",
  async ({ base, atHead, notesConfig }) => {
    using workspace = gitRepo({ 'package.json': '{}\n', 'src/a.ts': '', ...base });
    const { repo, root } = workspace;
    const to = atHead(repo);

    const range = await readRange({ repo, from: root, to });

    expect(range.notesConfig).toStrictEqual(notesConfig);
  },
);

test('a base config whose other entries this visual-review refuses still gives its guidance', async () => {
  using workspace = gitRepo({
    'package.json': '{}\n',
    'src/a.ts': '',
    'visual-review.config.json': '{"stack": {}, "notes": {"guidance": "Name the port."}}\n',
  });
  const { repo, root } = workspace;
  const to = commit(repo, { 'visual-review.config.json': guidanceConfig('Praise it.') });

  const range = await readRange({ repo, from: root, to });

  expect(range.notesConfig).toStrictEqual({ guidance: 'Name the port.' });
});

test('a base config that is no JSON gives no notes config, so a change repairing it can be reviewed', async () => {
  using workspace = gitRepo({
    'package.json': '{}\n',
    'src/a.ts': '',
    'visual-review.config.json': '{"notes": ',
  });
  const { repo, root } = workspace;
  const to = commit(repo, { 'visual-review.config.json': guidanceConfig('Praise it.') });

  const range = await readRange({ repo, from: root, to });

  expect(range.notesConfig).toStrictEqual({});
});

test('a base config whose notes entry does not parse fails the review, naming the file at the base and the problem', async () => {
  using workspace = gitRepo({
    'package.json': '{}\n',
    'src/a.ts': '',
    'visual-review.config.json': '{"notes": {"guidance": ["Name the port."]}}',
  });
  const { repo, root } = workspace;
  const to = commit(repo, { 'visual-review.config.json': '{}\n' });

  await expect(readRange({ repo, from: root, to })).rejects.toThrow(
    'visual-review.config.json at the base: notes.guidance: Invalid input: expected string, received array',
  );
});

test('a base notes entry that does not parse fails the review before any graph is read', async () => {
  using workspace = gitRepo({
    'package.json': '{}\n',
    'src/a.ts': '',
    'visual-review.config.json': '{"notes": {"guidance": 1}}\n',
  });
  const { repo, root } = workspace;
  const to = commit(repo, { 'visual-review.config.json': '{}\n' });
  const reader = fakeReader({
    roots: [{ root: '.' }],
    graph: async () => {
      throw new Error('a graph was read');
    },
  });

  await expect(readRange({ repo, from: root, to, readers: [reader] })).rejects.toThrow(
    'visual-review.config.json at the base: notes.guidance',
  );
});
