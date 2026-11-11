import { expect, test } from 'vitest';
import type { GraphNode } from './graph.ts';
import type { TestFile } from './test-changes.ts';
import { nodeOfTests, testsAfterSubjects, testsAlongside } from './tests-alongside.ts';

const node = (id: string, kind: GraphNode['kind'], path: string, parent?: string): GraphNode => ({
  id,
  kind,
  label: id,
  path,
  ...(parent !== undefined && { parent }),
});

const nodes: ReadonlyArray<GraphNode> = [
  node('shop', 'stack', ''),
  node('shop/layer/models', 'module', 'app/models', 'shop'),
  node('shop/class/User', 'file', 'app/models/user.rb', 'shop/layer/models'),
  node('shop/class/AbTesting', 'file', 'app/models/ab_testing.rb', 'shop/layer/models'),
  node('web', 'stack', ''),
  node('web/module/refunds', 'module', 'web/src/refunds', 'web'),
  node('web/file/refunds/refund.ts', 'file', 'web/src/refunds/refund.ts', 'web/module/refunds'),
  node('web/module/orders', 'module', 'web/src/orders', 'web'),
  node('api', 'stack', ''),
  node('api/module/refund', 'module', 'crates/api/src/refund.rs', 'api'),
];

const testFile = (path: string, stack: string): TestFile => ({ path, stack, statements: [] });

test.for([
  {
    test: 'web/src/refunds/refund.ts',
    stack: 'web',
    node: 'web/file/refunds/refund.ts',
    alongside: true,
  },
  {
    test: 'web/src/refunds/other.test.ts',
    stack: 'web',
    node: 'web/module/refunds',
    alongside: true,
  },
  {
    test: 'web/src/refunds/other.test.ts',
    stack: 'web',
    node: 'web/file/refunds/refund.ts',
    alongside: true,
  },
  {
    test: 'web/src/orders/other.test.ts',
    stack: 'web',
    node: 'web/file/refunds/refund.ts',
    alongside: false,
  },
  {
    test: 'web/src/refunds/orders.test.ts',
    stack: 'web',
    node: 'web/file/refunds/refund.ts',
    alongside: false,
  },
  {
    test: 'web/test/refund.spec.tsx',
    stack: 'web',
    node: 'web/file/refunds/refund.ts',
    alongside: true,
  },
  { test: 'web/test/refund.spec.tsx', stack: 'web', node: 'web/module/refunds', alongside: true },
  { test: 'test/models/user_test.rb', stack: 'shop', node: 'shop/class/User', alongside: true },
  { test: 'spec/models/user_spec.rb', stack: 'shop', node: 'shop/layer/models', alongside: true },
  {
    test: 'test/models/admin_user_test.rb',
    stack: 'shop',
    node: 'shop/class/User',
    alongside: false,
  },
  {
    test: 'test/models/ab_testing_test.rb',
    stack: 'shop',
    node: 'shop/class/AbTesting',
    alongside: true,
  },
  { test: 'web/test/refund.spec.tsx', stack: 'web', node: 'web/module/orders', alongside: false },
  { test: 'web/test/refunds.test.ts', stack: 'web', node: 'web/module/refunds', alongside: true },
  { test: 'web/test/user.test.ts', stack: 'web', node: 'shop/class/User', alongside: false },
  {
    test: 'test/models/refund_test.rb',
    stack: 'shop',
    node: 'web/file/refunds/refund.ts',
    alongside: false,
  },
  { test: 'crates/api/tests/refund.rs', stack: 'api', node: 'api/module/refund', alongside: true },
  { test: 'test/models/order_test.rb', stack: 'shop', node: 'shop', alongside: true },
  { test: 'web/src/refunds/refund.test.ts', stack: 'web', node: 'shop', alongside: false },
])('$test sits alongside $node: $alongside', ({ test: path, stack, node: id, alongside }) => {
  const at = nodes.find(each => each.id === id);
  if (at === undefined) throw new Error(`no node ${id}`);

  const found = testsAlongside({ nodes, node: at, tests: [testFile(path, stack)] });

  expect(found.map(file => file.path)).toEqual(alongside ? [path] : []);
});

test.for([
  { path: 'test/models/user_test.rb', stack: 'shop', at: 'shop/class/User' },
  { path: 'web/src/refunds/refund.test.ts', stack: 'web', at: 'web/file/refunds/refund.ts' },
  { path: 'web/src/refunds/rates.test.ts', stack: 'web', at: 'web/module/refunds' },
  { path: 'web/src/orders/refund.test.ts', stack: 'web', at: 'web/module/orders' },
  { path: 'test/models/order_test.rb', stack: 'shop', at: 'shop' },
  { path: 'test/models/refund_test.rb', stack: 'shop', at: 'shop' },
  { path: 'tools/check.test.ts', stack: 'skipped', at: undefined },
])('$path, of stack $stack, is on $at, whose Tests tab shows it', ({ path, stack, at }) => {
  const file = testFile(path, stack);

  const found = nodeOfTests({ nodes, file });

  expect(found).toBe(at);
  const onIt = nodes.find(each => each.id === found);
  expect(
    onIt === undefined ? [file] : testsAlongside({ nodes, node: onIt, tests: [file] }),
  ).toEqual([file]);
});

const web = (name: string): GraphNode => node(`web/file/${name}`, 'file', `web/src/${name}`, 'web');

test('the reading order reads a test file right after the file it tests, keeping the rest in order', () => {
  const parts = ['a.ts', 'b.ts', 'c.ts', 'a.test.ts', 'b.spec.ts', 'z.test.ts'].map(
    name => `web/file/${name}`,
  );
  expect(
    testsAfterSubjects({
      parts,
      cycles: [],
      nodes: [
        node('web', 'stack', ''),
        ...['a.ts', 'b.ts', 'c.ts', 'a.test.ts', 'b.spec.ts', 'z.test.ts'].map(web),
      ],
      tests: ['a.test.ts', 'b.spec.ts', 'z.test.ts'].map(name =>
        testFile(`web/src/${name}`, 'web'),
      ),
    }),
  ).toStrictEqual(
    ['a.ts', 'a.test.ts', 'b.ts', 'b.spec.ts', 'c.ts', 'z.test.ts'].map(name => `web/file/${name}`),
  );
});

test('a test file stays where it is when it or its subject is in a cycle, or its subject is in another stack', () => {
  const parts = ['web/file/a.ts', 'web/file/b.ts', 'web/file/a.test.ts', 'web/file/b.test.ts'];
  expect(
    testsAfterSubjects({
      parts,
      cycles: [['web/file/a.ts', 'web/file/c.ts']],
      nodes: [node('web', 'stack', ''), ...['a.ts', 'b.ts', 'a.test.ts', 'b.test.ts'].map(web)],
      tests: [testFile('web/src/a.test.ts', 'web'), testFile('web/src/b.test.ts', 'api')],
    }),
  ).toStrictEqual(parts);
});

test("a test file named after no node, such as a Rust crate's integration test, tests every node in the crate holding it", () => {
  const crate: ReadonlyArray<GraphNode> = [
    node('rust', 'stack', ''),
    node('rust/crate/app', 'package', 'crates/app', 'rust'),
    node('rust/mod/app/main.rs', 'file', 'crates/app/src/main.rs', 'rust/crate/app'),
    node('rust/crate/other', 'package', 'crates/other', 'rust'),
    node('rust/mod/other/lib.rs', 'file', 'crates/other/src/lib.rs', 'rust/crate/other'),
  ];
  const integration = testFile('crates/app/tests/index.rs', 'rust');
  const named = testFile('crates/app/tests/lib.rs', 'rust');
  const alongside = (id: string, test: TestFile) =>
    testsAlongside({
      nodes: crate,
      node: crate.find(each => each.id === id) ?? node(id, 'file', id),
      tests: [test],
    }).length > 0;
  expect(alongside('rust/mod/app/main.rs', integration)).toBe(true);
  expect(alongside('rust/mod/other/lib.rs', integration)).toBe(false);
  expect(alongside('rust/mod/app/main.rs', named)).toBe(false);
});
