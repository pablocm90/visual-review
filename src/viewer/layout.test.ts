import { expect, test } from 'vitest';
import type { DiffedNode } from '../diff-graphs.ts';
import { layoutDiff } from './layout.ts';

const node = (id: string, kind: DiffedNode['kind'], parent?: string): DiffedNode => ({
  id,
  kind,
  label: id,
  path: id,
  state: 'unchanged',
  ...(parent === undefined ? {} : { parent }),
});

test('an edge between two parts of one expanded box is drawn inside that box', async () => {
  const layout = await layoutDiff({
    nodes: [
      node('rust', 'stack'),
      node('domain', 'package', 'rust'),
      node('application', 'package', 'rust'),
      node('http-adapter', 'package', 'rust'),
      node('shop', 'package', 'rust'),
      node('lib.rs', 'file', 'application'),
      node('sign_up', 'file', 'application'),
    ],
    edges: [
      { from: 'application', to: 'domain', state: 'unchanged' },
      { from: 'http-adapter', to: 'application', state: 'unchanged' },
      { from: 'shop', to: 'http-adapter', state: 'unchanged' },
      { from: 'lib.rs', to: 'sign_up', state: 'added' },
    ],
  });

  const [rust] = layout.stacks;
  const application = rust?.children.find(child => child.id === 'application');
  const inner = rust?.edges.find(edge => edge.from === 'lib.rs');
  expect(inner?.points.length).toBeGreaterThan(1);
  inner?.points.forEach(point => {
    expect(point.x).toBeGreaterThanOrEqual(application?.x ?? Number.NaN);
    expect(point.x).toBeLessThanOrEqual((application?.x ?? 0) + (application?.width ?? 0));
    expect(point.y).toBeGreaterThanOrEqual(application?.y ?? Number.NaN);
    expect(point.y).toBeLessThanOrEqual((application?.y ?? 0) + (application?.height ?? 0));
  });
});

test('a call from a file to another stack itself turns in the gap between the two stacks', async () => {
  const layout = await layoutDiff({
    nodes: [
      node('a', 'stack'),
      node('a.ts', 'file', 'a'),
      node('b', 'stack'),
      node('b.ts', 'file', 'b'),
    ],
    edges: [{ from: 'a.ts', to: 'b', state: 'added' }],
  });

  const [a, b] = layout.stacks;
  const turn = layout.calls[0]?.points[1]?.x;
  expect(turn).toBeGreaterThan((a?.x ?? Number.NaN) + (a?.width ?? 0));
  expect(turn).toBeLessThan(b?.x ?? Number.NaN);
});
