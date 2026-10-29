import { expect, test } from 'vitest';
import { readRustTests } from '../readers/rust/rust-tests.ts';
import { readTypeScriptTests } from '../readers/typescript/typescript-tests.ts';
import { type TestStatement, testChanges, withMovedTests } from './test-changes.ts';

test('reads a new file as a tree of its describe blocks and tests, in source order', () => {
  const after = [
    "import { render } from '@testing-library/react';",
    'const renderPage = (range: string) => render(<ReviewPage range={range} />);',
    "test('reads a range', () => {});",
    "describe('the review page', () => {",
    "  it('shows the range', () => {});",
    "  describe('when a node is selected', () => {",
    "    test('narrows the patches', () => {});",
    '  });',
    '});',
  ].join('\n');

  expect(testChanges({ read: readTypeScriptTests, after })).toEqual([
    { kind: 'test', name: 'reads a range', change: 'added' },
    {
      kind: 'heading',
      name: 'the review page',
      children: [
        { kind: 'test', name: 'shows the range', change: 'added' },
        {
          kind: 'heading',
          name: 'when a node is selected',
          children: [{ kind: 'test', name: 'narrows the patches', change: 'added' }],
        },
      ],
    },
  ]);
});

test("reads Playwright's test.describe as a heading", () => {
  const after = [
    "test.describe('the home page', () => {",
    "  test('shows the version', async ({ page }) => {});",
    '});',
  ].join('\n');

  expect(testChanges({ read: readTypeScriptTests, after })).toEqual([
    {
      kind: 'heading',
      name: 'the home page',
      children: [{ kind: 'test', name: 'shows the version', change: 'added' }],
    },
  ]);
});

test('marks a test whose body changed as edited, and one whose body did not as unchanged', () => {
  const before = [
    "test('reads a range', () => {",
    '  expect(readRange()).toBe(1);',
    '});',
    "test('writes a page', () => {});",
  ].join('\n');
  const after = [
    "test('reads a range', () => {",
    '  expect(readRange()).toBe(2);',
    '});',
    "test('writes a page', () => {});",
  ].join('\n');

  expect(testChanges({ read: readTypeScriptTests, before, after })).toEqual([
    { kind: 'test', name: 'reads a range', change: 'edited' },
    { kind: 'test', name: 'writes a page', change: 'unchanged' },
  ]);
});

test('marks a removed test where it was, among the tests that stayed and the ones added', () => {
  const before = [
    "test('reads a pull request', () => {});",
    "test('reads a range', () => {});",
    "test('reads the notes', () => {});",
    "test('writes a page', () => {});",
  ].join('\n');
  const after = [
    "test('reads a range', () => {});",
    "test('writes a page', () => {});",
    "test('prunes old pages', () => {});",
  ].join('\n');

  expect(testChanges({ read: readTypeScriptTests, before, after })).toEqual([
    { kind: 'test', name: 'reads a pull request', change: 'removed' },
    { kind: 'test', name: 'reads a range', change: 'unchanged' },
    { kind: 'test', name: 'reads the notes', change: 'removed' },
    { kind: 'test', name: 'writes a page', change: 'unchanged' },
    { kind: 'test', name: 'prunes old pages', change: 'added' },
  ]);
});

test('compares the tests inside a describe block that stayed', () => {
  const before = [
    "describe('the review page', () => {",
    "  it('shows the range', () => {});",
    "  it('lists unplaced notes', () => {});",
    '});',
  ].join('\n');
  const after = [
    "describe('the review page', () => {",
    "  it('shows the range', () => {});",
    "  it('names the pull request', () => {});",
    '});',
  ].join('\n');

  expect(testChanges({ read: readTypeScriptTests, before, after })).toEqual([
    {
      kind: 'heading',
      name: 'the review page',
      children: [
        { kind: 'test', name: 'shows the range', change: 'unchanged' },
        { kind: 'test', name: 'lists unplaced notes', change: 'removed' },
        { kind: 'test', name: 'names the pull request', change: 'added' },
      ],
    },
  ]);
});

test('yields nothing for a file whose tests did not change', () => {
  const before = [
    "const range = 'main..head';",
    "describe('the range', () => {",
    "  test('reads a range', () => {});",
    '});',
  ].join('\n');
  const after = [
    "const range = 'main..feature';",
    "describe('the range', () => {",
    "  test('reads a range', () => {});",
    '});',
  ].join('\n');

  expect(testChanges({ read: readTypeScriptTests, before, after })).toEqual([]);
});

test('marks every test of a deleted file as removed', () => {
  const before = [
    "describe('the review page', () => {",
    "  it('lists unplaced notes', () => {});",
    '});',
  ].join('\n');

  expect(testChanges({ read: readTypeScriptTests, before })).toEqual([
    {
      kind: 'heading',
      name: 'the review page',
      children: [{ kind: 'test', name: 'lists unplaced notes', change: 'removed' }],
    },
  ]);
});

test('reads a test that became a describe block of the same name as removed and added', () => {
  const before = "test('the review page', () => {});";
  const after = [
    "describe('the review page', () => {",
    "  it('shows the range', () => {});",
    '});',
  ].join('\n');

  expect(testChanges({ read: readTypeScriptTests, before, after })).toEqual([
    { kind: 'test', name: 'the review page', change: 'removed' },
    {
      kind: 'heading',
      name: 'the review page',
      children: [{ kind: 'test', name: 'shows the range', change: 'added' }],
    },
  ]);
});

test.for([
  { shape: 'a call of another function', text: "renderPage('the review page', () => {});" },
  { shape: 'an assignment', text: 'count = 1;' },
  { shape: 'a call with no arguments', text: 'main();' },
  { shape: 'an immediately invoked function', text: "(() => {})('the review page');" },
  { shape: 'a describe with no callback', text: "describe('the review page');" },
  {
    shape: 'a describe whose callback is an expression',
    text: "describe('the review page', () => it('shows the range', () => {}));",
  },
])('skips $shape', ({ text }) => {
  const after = [text, "it('shows the range', () => {});"].join('\n');

  expect(testChanges({ read: readTypeScriptTests, after })).toEqual([
    { kind: 'test', name: 'shows the range', change: 'added' },
  ]);
});

test('reads a Rust file as its test fns, under any attribute path ending in test, with underscores read as spaces, its modules holding tests as headings, its cfg(test) module dropped and an ignored test labelled skip', () => {
  const after = [
    'pub fn route() {}',
    'mod handlers {',
    '    pub fn serve() {}',
    '}',
    '#[cfg(test)]',
    'mod tests {',
    '    use super::*;',
    '    #[allow(dead_code)]',
    '    fn helper() {}',
    '    #[test]',
    '    fn reads_a_route() {}',
    '    mod unknown_routes {',
    '        #[tokio::test(flavor = "multi_thread")]',
    '        async fn are_rejected() {}',
    '    }',
    '    #[sqlx::test]',
    '    #[ignore = "needs a database"]',
    '    async fn stores_the_route(pool: PgPool) {}',
    '    #[cfg(feature = "slow")]',
    '    mod slow_routes {',
    '        #[test]',
    '        fn time_out() {}',
    '    }',
    '}',
  ].join('\n');

  expect(testChanges({ read: readRustTests, after })).toEqual([
    { kind: 'test', name: 'reads a route', change: 'added' },
    {
      kind: 'heading',
      name: 'unknown routes',
      children: [{ kind: 'test', name: 'are rejected', change: 'added' }],
    },
    { kind: 'test', name: 'stores the route', change: 'added', label: 'skip' },
    {
      kind: 'heading',
      name: 'slow routes',
      children: [{ kind: 'test', name: 'time out', change: 'added' }],
    },
  ]);
});

test('marks a Rust test edited when its body or its attributes change, inside the modules that stayed', () => {
  const file = (tests: ReadonlyArray<string>) => ['mod unknown_routes {', ...tests, '}'].join('\n');
  const before = file([
    '#[test]',
    'fn are_rejected() { assert!(true); }',
    '#[test]',
    'fn are_logged() {}',
    '#[test]',
    'fn are_counted() {}',
  ]);
  const after = file([
    '#[test]',
    'fn are_rejected() { assert!(false); }',
    '#[tokio::test]',
    'fn are_logged() {}',
    '#[test]',
    'fn are_counted() {}',
  ]);

  expect(testChanges({ read: readRustTests, before, after })).toEqual([
    {
      kind: 'heading',
      name: 'unknown routes',
      children: [
        { kind: 'test', name: 'are rejected', change: 'edited' },
        { kind: 'test', name: 'are logged', change: 'edited' },
        { kind: 'test', name: 'are counted', change: 'unchanged' },
      ],
    },
  ]);
});

// biome-ignore-start lint/suspicious/noTemplateCurlyInString: the fixture is source text that holds template literals
test('reads a name that is not a plain string as written, once per table', () => {
  const after = [
    "test.for([{ kind: 'a' }, { kind: 'b' }])('$kind is rejected', () => {});",
    'it.each`',
    '  a',
    '  ${1}',
    "`('adds $a', () => {});",
    'test(`${kind} is accepted`, () => {});',
    'test(name, () => {});',
    "describe.each([1, 2])('with %i items', () => {",
    "  it('counts them', () => {});",
    '});',
  ].join('\n');

  expect(testChanges({ read: readTypeScriptTests, after })).toEqual([
    { kind: 'test', name: "'$kind is rejected'", change: 'added' },
    { kind: 'test', name: "'adds $a'", change: 'added' },
    { kind: 'test', name: '`${kind} is accepted`', change: 'added' },
    { kind: 'test', name: 'name', change: 'added' },
    {
      kind: 'heading',
      name: "'with %i items'",
      children: [{ kind: 'test', name: 'counts them', change: 'added' }],
    },
  ]);
});
// biome-ignore-end lint/suspicious/noTemplateCurlyInString: the fixture is source text that holds template literals

test('labels a skipped, only or todo test or describe block, and marks a test edited when its label changes', () => {
  const before = ["test('stays', () => {});", "test('gets skipped', () => {});"].join('\n');
  const after = [
    "test.skip('stays', () => {});",
    "test('gets skipped', () => {});",
    "it.only('runs alone', () => {});",
    "test.todo('reads renames');",
    "test.skip.for([1])('skips %i', () => {});",
    "describe.skip('the old page', () => {",
    "  it('shows the range', () => {});",
    '});',
  ].join('\n');

  expect(testChanges({ read: readTypeScriptTests, before, after })).toEqual([
    { kind: 'test', name: 'stays', change: 'edited', label: 'skip' },
    { kind: 'test', name: 'gets skipped', change: 'unchanged' },
    { kind: 'test', name: 'runs alone', change: 'added', label: 'only' },
    { kind: 'test', name: 'reads renames', change: 'added', label: 'todo' },
    { kind: 'test', name: "'skips %i'", change: 'added', label: 'skip' },
    {
      kind: 'heading',
      name: 'the old page',
      label: 'skip',
      children: [{ kind: 'test', name: 'shows the range', change: 'added' }],
    },
  ]);
});

const marked = (name: string, change: 'added' | 'removed' | 'edited'): TestStatement => ({
  kind: 'test',
  name,
  change,
});

const PASSWORD_LENGTH = 'accepts only passwords of 12 to 128 characters';

test('a test whose name leaves one file and arrives in one other is moved, in both, under any heading, past unreadable files and namesakes that stayed', () => {
  const moved = withMovedTests([
    {
      path: 'crates/application/src/sign_up.rs',
      statements: [marked(PASSWORD_LENGTH, 'removed'), marked('records nothing', 'edited')],
    },
    {
      path: 'crates/models/src/password.rs',
      statements: [
        { kind: 'heading', name: 'tests', children: [marked(PASSWORD_LENGTH, 'added')] },
        marked('hashes with argon2id', 'added'),
      ],
    },
    { path: 'crates/models/src/email.rs', statements: [marked(PASSWORD_LENGTH, 'edited')] },
    { path: 'crates/models/src/broken.rs', unreadable: 'expected `fn`' },
  ]);

  expect(moved).toStrictEqual([
    {
      path: 'crates/application/src/sign_up.rs',
      statements: [
        { ...marked(PASSWORD_LENGTH, 'removed'), movedTo: 'crates/models/src/password.rs' },
        marked('records nothing', 'edited'),
      ],
    },
    {
      path: 'crates/models/src/password.rs',
      statements: [
        {
          kind: 'heading',
          name: 'tests',
          children: [
            {
              ...marked(PASSWORD_LENGTH, 'added'),
              movedFrom: 'crates/application/src/sign_up.rs',
            },
          ],
        },
        marked('hashes with argon2id', 'added'),
      ],
    },
    { path: 'crates/models/src/email.rs', statements: [marked(PASSWORD_LENGTH, 'edited')] },
    { path: 'crates/models/src/broken.rs', unreadable: 'expected `fn`' },
  ]);
});

test.for([
  {
    case: 'it only left',
    files: [{ path: 'a.test.ts', statements: [marked('reads', 'removed')] }],
  },
  {
    case: 'it left two files',
    files: [
      { path: 'a.test.ts', statements: [marked('reads', 'removed')] },
      { path: 'b.test.ts', statements: [marked('reads', 'removed')] },
      { path: 'c.test.ts', statements: [marked('reads', 'added')] },
    ],
  },
  {
    case: 'it arrived in two files',
    files: [
      { path: 'a.test.ts', statements: [marked('reads', 'removed')] },
      { path: 'b.test.ts', statements: [marked('reads', 'added')] },
      { path: 'c.test.ts', statements: [marked('reads', 'added')] },
    ],
  },
  {
    case: 'it stayed in its file, under another heading',
    files: [
      {
        path: 'a.test.ts',
        statements: [
          marked('reads', 'removed'),
          { kind: 'heading' as const, name: 'notes', children: [marked('reads', 'added')] },
        ],
      },
    ],
  },
])('a test is not moved when $case', ({ files }) => {
  expect(withMovedTests(files)).toStrictEqual(files);
});
