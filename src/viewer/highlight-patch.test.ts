import { expect, test } from 'vitest';
import { highlightPatch, languageOf } from './highlight-patch.ts';

const patchOf = (path: string, ...hunkLines: readonly string[]) => ({
  path,
  patch: [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, ...hunkLines].join(
    '\n',
  ),
});

const scopesOf = (line: { readonly pieces: readonly { readonly scopes: readonly string[] }[] }) =>
  line.pieces.map(piece => piece.scopes);

test('a patch shows from its first hunk, each line with its kind, its prefix and its code in pieces scoped by language', () => {
  const lines = highlightPatch(
    patchOf(
      'crates/domain/src/lib.rs',
      '@@ -1,2 +1,2 @@ mod a',
      ' mod a;',
      '-fn x() {}',
      '+fn y() {}',
    ),
  );

  expect(lines.map(line => [line.kind, line.prefix])).toEqual([
    ['header', ''],
    ['context', ' '],
    ['removed', '-'],
    ['added', '+'],
  ]);
  expect(lines[3]?.pieces).toEqual([
    { text: 'fn', scopes: ['hljs-keyword'] },
    { text: ' ', scopes: [] },
    { text: 'y', scopes: ['hljs-title function_'] },
    { text: '() {}', scopes: [] },
  ]);
});

test.for([
  { path: 'crates/domain/src/lib.rs', language: 'rust' },
  { path: 'web/src/utils/x.ts', language: 'typescript' },
  { path: 'web/src/App.tsx', language: 'typescript' },
  { path: 'web/.dependency-cruiser.cjs', language: 'javascript' },
  { path: 'web/vite.config.mjs', language: 'javascript' },
  { path: 'web/eslint.config.js', language: 'javascript' },
  { path: 'web/package.json', language: 'json' },
  { path: 'crates/domain/Cargo.toml', language: 'ini' },
  { path: 'Cargo.lock', language: 'ini' },
  { path: 'web/.editorconfig', language: 'ini' },
  { path: 'pnpm-workspace.yaml', language: 'yaml' },
  { path: '.github/workflows/ci.yml', language: 'yaml' },
  { path: 'README.md', language: 'markdown' },
  { path: 'web/index.html', language: 'xml' },
  { path: 'tools/visual-review/src/viewer/styles.css', language: 'css' },
  { path: 'web/.env.development', language: undefined },
])('$path is coloured as $language', ({ path, language }) => {
  expect(languageOf(path)).toBe(language);
});

test("a comment opened on a hunk's context line runs on into its removed and added lines", () => {
  const lines = highlightPatch(
    patchOf(
      'crates/domain/src/lib.rs',
      '@@ -1,2 +1,2 @@',
      ' fn a() {} /* opens',
      '-closes */ fn b() {}',
      '+closes */ fn c() {}',
    ),
  );

  expect(lines[2]?.pieces[0]).toEqual({ text: 'closes */', scopes: ['hljs-comment'] });
  expect(lines[3]?.pieces[0]).toEqual({ text: 'closes */', scopes: ['hljs-comment'] });
  expect(lines[3]?.pieces[2]).toEqual({ text: 'fn', scopes: ['hljs-keyword'] });
});

test('a removed line colours only the old side and an added line only the new, context following the new', () => {
  const lines = highlightPatch(
    patchOf(
      'crates/domain/src/lib.rs',
      '@@ -1,2 +1,2 @@',
      '-fn a() {} /* opens',
      '+fn a() {} // ends',
      ' fn b() {}',
      '+fn c() {}',
    ),
  );

  expect(lines.slice(3).map(line => line.pieces[0])).toEqual([
    { text: 'fn', scopes: ['hljs-keyword'] },
    { text: 'fn', scopes: ['hljs-keyword'] },
  ]);
});

test('a second hunk starts fresh, whatever the first left open', () => {
  const lines = highlightPatch(
    patchOf('crates/domain/src/lib.rs', '@@ -1 +1 @@', ' /* opens', '@@ -9 +9 @@', '+fn z() {}'),
  );

  expect(lines[3]?.pieces[0]).toEqual({ text: 'fn', scopes: ['hljs-keyword'] });
});

test('code keeps its <, >, & and quotes', () => {
  const lines = highlightPatch(
    patchOf('crates/domain/src/lib.rs', '@@ -0,0 +1 @@', `+let s = "<&>"; let c = '"';`),
  );

  expect(lines[1]?.pieces.map(piece => piece.text).join('')).toBe(`let s = "<&>"; let c = '"';`);
});

test("a missing newline's note is its own unscoped line, and the lines after it keep their sides", () => {
  const lines = highlightPatch(
    patchOf(
      'crates/domain/src/lib.rs',
      '@@ -1 +1,2 @@',
      '-fn a() {}',
      '\\ No newline at end of file',
      '+fn a() {}',
      '+fn b() {}',
    ),
  );

  expect(lines[2]).toEqual({
    kind: 'note',
    prefix: '',
    pieces: [{ text: '\\ No newline at end of file', scopes: [] }],
  });
  expect(lines[4]?.pieces[0]).toEqual({ text: 'fn', scopes: ['hljs-keyword'] });
});

test('a file of a plain type shows each line as one unscoped piece', () => {
  const lines = highlightPatch(patchOf('web/.env.development', '@@ -0,0 +1 @@', '+A=<b> "c"'));

  expect(lines[1]?.pieces).toEqual([{ text: 'A=<b> "c"', scopes: [] }]);
});

test.for([
  { path: 'web/src/x.ts', code: 'const a = 1;' },
  { path: 'web/src/App.tsx', code: 'const a = <div />;' },
  { path: 'web/.dependency-cruiser.cjs', code: 'const a = 1;' },
  { path: 'web/package.json', code: '{ "a": 1 }' },
  { path: 'Cargo.toml', code: '[package]' },
  { path: 'ci.yml', code: 'on: push' },
  { path: 'README.md', code: '# Title' },
  { path: 'web/index.html', code: '<div></div>' },
  { path: 'styles.css', code: 'a { color: red; }' },
])('$path is coloured', ({ path, code }) => {
  const [, line] = highlightPatch(patchOf(path, '@@ -0,0 +1 @@', `+${code}`));

  expect(line && scopesOf(line).some(scopes => scopes.length > 0)).toBe(true);
});

test('a patch without a hunk, such as a pure rename, shows its last line as a plain note', () => {
  const lines = highlightPatch({
    path: 'crates/domain/src/b.rs',
    patch: [
      'diff --git a/crates/domain/src/a.rs b/crates/domain/src/b.rs',
      'similarity index 100%',
      'rename from crates/domain/src/a.rs',
      'rename to crates/domain/src/b.rs',
    ].join('\n'),
  });

  expect(lines).toEqual([
    {
      kind: 'note',
      prefix: '',
      pieces: [{ text: 'rename to crates/domain/src/b.rs', scopes: [] }],
    },
  ]);
});
