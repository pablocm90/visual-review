import { expect, test } from 'vitest';
import type { GraphNode } from './graph.ts';
import type { TestFile } from './test-changes.ts';
import { testsAlongside } from './tests-alongside.ts';

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
  node('web', 'stack', 'web'),
  node('web/module/refunds', 'module', 'web/src/refunds', 'web'),
  node('web/file/refunds/refund.ts', 'file', 'web/src/refunds/refund.ts', 'web/module/refunds'),
  node('web/module/orders', 'module', 'web/src/orders', 'web'),
  node('api', 'stack', 'crates/api'),
  node('api/module/refund', 'module', 'crates/api/src/refund.rs', 'api'),
];

const testFile = (path: string): TestFile => ({ path, statements: [] });

test.for([
  { test: 'web/src/refunds/refund.ts', node: 'web/file/refunds/refund.ts', alongside: true },
  { test: 'web/src/refunds/other.test.ts', node: 'web/module/refunds', alongside: true },
  { test: 'web/src/refunds/other.test.ts', node: 'web/file/refunds/refund.ts', alongside: false },
  { test: 'web/test/refund.spec.tsx', node: 'web/file/refunds/refund.ts', alongside: true },
  { test: 'web/test/refund.spec.tsx', node: 'web/module/refunds', alongside: true },
  { test: 'test/models/user_test.rb', node: 'shop/class/User', alongside: true },
  { test: 'spec/models/user_spec.rb', node: 'shop/layer/models', alongside: true },
  { test: 'test/models/admin_user_test.rb', node: 'shop/class/User', alongside: false },
  { test: 'test/models/ab_testing_test.rb', node: 'shop/class/AbTesting', alongside: true },
  { test: 'web/test/refund.spec.tsx', node: 'web/module/orders', alongside: false },
  { test: 'web/test/refunds.test.ts', node: 'web/module/refunds', alongside: true },
  { test: 'web/test/user.test.ts', node: 'shop/class/User', alongside: false },
  { test: 'test/models/refund_test.rb', node: 'web/file/refunds/refund.ts', alongside: false },
  { test: 'crates/api/tests/refund.rs', node: 'api/module/refund', alongside: true },
  { test: 'web/src/refunds/refund.test.ts', node: 'shop', alongside: true },
])('$test sits alongside $node: $alongside', ({ test: path, node: id, alongside }) => {
  const at = nodes.find(each => each.id === id);
  if (at === undefined) throw new Error(`no node ${id}`);

  const found = testsAlongside({ nodes, node: at, tests: [testFile(path)] });

  expect(found.map(file => file.path)).toEqual(alongside ? [path] : []);
});
