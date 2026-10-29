import { expect, test } from 'vitest';
import { readRange } from '../test-support/read-range.ts';
import {
  cargoWorkspace,
  commit,
  crateFiles,
  git,
  gitRepo,
  writeFiles,
} from '../test-support/repos.ts';

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

test("a config stack added under the id of another reader's stack fails the review", async () => {
  using workspace = cargoWorkspace();
  const { repo, root } = workspace;
  const to = commit(repo, {
    'tools/gen/src/a.ts': '',
    'visual-review.config.json':
      '{"stacks": {"rust": {"reader": "typescript", "root": "tools/gen"}}}',
  });

  await expect(readRange({ repo, from: root, to })).rejects.toThrow(
    new Error(
      'visual-review.config.json: stacks.rust is drawn by another reader; add the stack under another key, or drop its reader and root',
    ),
  );
});

test("a TS stack told apart from another reader's takes its settings by the id it is drawn under", async () => {
  using workspace = cargoWorkspace();
  const { repo, root } = workspace;
  const to = commit(repo, {
    'rust/package.json': '{}\n',
    'rust/src/modules/AppInfo/app-info.ts': '',
    'visual-review.config.json': '{"stacks": {"rust~2": {"boxes": ["modules/*"]}}}',
  });

  const range = await readRange({ repo, from: root, to });

  expect(range.after.nodes).toContainEqual(
    expect.objectContaining({ id: 'rust~2/module/modules/AppInfo', parent: 'rust~2' }),
  );
});

test('a stack the config sets to false is dropped from both sides, with every edge to or from it and its test files', async () => {
  using workspace = gitRepo({
    'web/package.json': '{}\n',
    'web/src/a.ts': "import 'e2e';\n",
    'e2e/package.json': '{"name": "e2e"}\n',
    'e2e/src/specs/b.ts': '',
  });
  const { repo, root } = workspace;
  const to = commit(repo, {
    'visual-review.config.json': '{"stacks": {"e2e": false}}\n',
    'web/test/a.test.ts': "test('adds', () => {});\n",
    'e2e/test/b.test.ts': "test('signs in', () => {});\n",
  });

  const range = await readRange({ repo, from: root, to });

  expect(nodeIds(range.before)).toEqual(['web', 'web/file/a.ts']);
  expect(nodeIds(range.after)).toEqual(['web', 'web/file/a.ts']);
  expect(range.after.edges).toEqual([]);
  expect(range.tests.map(({ path }) => path)).toEqual(['web/test/a.test.ts']);
});

test("a stack's label from the config replaces its drawn label on both sides, its id and its files' labels kept", async () => {
  using workspace = gitRepo({ 'web/package.json': '{}\n', 'web/src/a.ts': '' });
  const { repo, root } = workspace;
  const to = commit(repo, {
    'visual-review.config.json': '{"stacks": {"web": {"label": "Web app"}}}\n',
  });

  const range = await readRange({ repo, from: root, to });

  const relabelled = expect.objectContaining({ id: 'web', label: 'Web app' });
  expect(range.before.nodes).toContainEqual(relabelled);
  expect(range.after.nodes).toContainEqual(relabelled);
  expect(range.after.nodes).toContainEqual(
    expect.objectContaining({ id: 'web/file/a.ts', label: 'a.ts' }),
  );
});

test.for([
  { reason: 'a stack detected on neither side', key: 'wbe' },
  { reason: 'a node that is no stack', key: 'web/file/a.ts' },
])('a config naming $reason fails the review, naming the file and the key', async ({ key }) => {
  using workspace = gitRepo({ 'web/package.json': '{}\n', 'web/src/a.ts': '' });
  const { repo, root } = workspace;
  const to = commit(repo, {
    'visual-review.config.json': JSON.stringify({ stacks: { [key]: { label: 'Web' } } }),
  });

  await expect(readRange({ repo, from: root, to })).rejects.toThrow(
    `visual-review.config.json: stacks.${key} names no detected stack; give it reader and root to add one`,
  );
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

test("a config field the stack's reader does not take fails the review once, naming the file, the stack and the field", async () => {
  using workspace = cargoWorkspace();
  const { repo, root } = workspace;
  const to = commit(repo, {
    'visual-review.config.json': '{"stacks": {"rust": {"boxes": ["*"]}}}',
  });

  await expect(readRange({ repo, from: root, to })).rejects.toThrow(
    new Error('visual-review.config.json: stacks.rust.boxes is not taken by the rust reader'),
  );
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

test.for([
  {
    reason: 'a TS root',
    files: { 'web/package.json': '{}\n', 'web/src/a.ts': '' },
    added: { reader: 'typescript', root: 'web' },
    detected: 'web',
  },
  {
    reason: 'a TS root spelled another way',
    files: { 'web/package.json': '{}\n', 'web/src/a.ts': '' },
    added: { reader: 'typescript', root: './web/' },
    detected: 'web',
  },
  {
    reason: 'the Rust workspace at the repo root',
    files: {
      'Cargo.toml': '[workspace]\nmembers = ["crates/*"]\nresolver = "2"\n',
      ...crateFiles('core'),
    },
    added: { reader: 'rust', root: '.' },
    detected: 'rust',
  },
])(
  'a config stack added at $reason that detection already reads fails the review, naming the detected stack',
  async ({ files, added, detected }) => {
    using workspace = gitRepo(files);
    const { repo, root } = workspace;
    const to = commit(repo, {
      'visual-review.config.json': JSON.stringify({ stacks: { front: added } }),
    });

    await expect(readRange({ repo, from: root, to })).rejects.toThrow(
      new Error(
        `visual-review.config.json: stacks.front.root: ${added.root} is detected as stack ${detected}; set stacks.${detected} instead`,
      ),
    );
  },
);

test('a config stack added under the id of a detected stack fails the review, naming where that stack was detected', async () => {
  using workspace = gitRepo({
    'package.json': '{"name": "site"}\n',
    'src/a.ts': '',
    'app/src/b.ts': '',
  });
  const { repo, root } = workspace;
  const to = commit(repo, {
    'visual-review.config.json': '{"stacks": {"site": {"reader": "typescript", "root": "app"}}}',
  });

  await expect(readRange({ repo, from: root, to })).rejects.toThrow(
    new Error(
      'visual-review.config.json: stacks.site is detected at .; add the stack under another key, or drop its reader and root',
    ),
  );
});

test.for([
  {
    config: { linkers: { 'fetch-axum': { from: ['admin'] } } },
    error: 'linkers.fetch-axum.from: admin names no typescript stack on either side',
  },
  {
    config: { linkers: { 'fetch-axum': { to: ['web'] } } },
    error: 'linkers.fetch-axum.to: web names no rust stack on either side',
  },
  {
    config: { stacks: { web: false }, linkers: { 'fetch-axum': { from: ['web'] } } },
    error: 'linkers.fetch-axum.from: web is dropped by stacks.web',
  },
])(
  'a linker limited to a stack the page does not draw fails the review: $error',
  async ({ config, error }) => {
    using workspace = cargoWorkspace();
    const { repo, root } = workspace;
    const to = commit(repo, {
      'web/package.json': '{}\n',
      'web/src/a.ts': '',
      'visual-review.config.json': JSON.stringify(config),
    });

    await expect(readRange({ repo, from: root, to })).rejects.toThrow(
      `visual-review.config.json: ${error}`,
    );
  },
);
