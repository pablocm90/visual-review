import { expect, test } from 'vitest';
import { fakeReader } from '../test-support/fake-reader.ts';
import { parseConfig } from './config.ts';
import type { Graph } from './graph.ts';
import { readStacks } from './read-stacks.ts';

const shopGraph = (): Graph => ({
  nodes: [
    { id: 'shop', kind: 'stack', label: 'shop', path: '.' },
    {
      id: 'shop/class/User',
      kind: 'file',
      label: 'User',
      parent: 'shop',
      path: 'app/models/user.rb',
    },
    {
      id: 'shop/class/Order',
      kind: 'file',
      label: 'Order',
      parent: 'shop',
      path: 'app/models/order.rb',
    },
  ],
  edges: [{ from: 'shop/class/Order', to: 'shop/class/User' }],
});

test("a reader's one stack is drawn as the graph it reads at that stack's root", async () => {
  const side = await readStacks({
    directory: '/checkout',
    repoName: 'shop',
    config: parseConfig('{}'),
    readers: [fakeReader({ stacks: { '.': 'shop' }, graphs: { '.': shopGraph() } })],
    linkers: [],
    onPath: () => true,
  });

  expect(side.graph).toEqual(shopGraph());
});
