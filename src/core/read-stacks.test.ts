import { expect, test } from 'vitest';
import { fakeReader } from '../test-support/fake-reader.ts';
import { parseConfig } from './config.ts';
import type { Graph } from './graph.ts';
import { readStacks } from './read-stacks.ts';
import type { Reader } from './reader.ts';

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

type SideOptions = {
  readonly readers: ReadonlyArray<Reader>;
  readonly config?: string;
};

const readSide = ({ readers, config = '{}' }: SideOptions) =>
  readStacks({
    directory: '/checkout',
    repoName: 'shop',
    config: parseConfig(config),
    readers,
    linkers: [],
    onPath: () => true,
  });

const drawnStacks = (side: Awaited<ReturnType<typeof readSide>>) =>
  side.stacks.map(({ root, stack }) => ({ root, stack }));

test("a reader's one stack is drawn as the graph it reads at that stack's root", async () => {
  const side = await readSide({
    readers: [fakeReader({ roots: [{ root: '.' }], graph: async () => shopGraph() })],
  });

  expect(side.graph).toEqual(shopGraph());
});

test('two readers each finding the repo root draw it under the repo name and then its first suffix, in reader order', async () => {
  const side = await readSide({
    readers: [
      fakeReader({ name: 'rust', roots: [{ root: '.' }] }),
      fakeReader({ name: 'typescript', roots: [{ root: '.' }] }),
    ],
  });

  expect(drawnStacks(side)).toEqual([
    { root: '.', stack: 'shop' },
    { root: '.', stack: 'shop~2' },
  ]);
});

test('a root its reader does not hold takes no id, so the next root with its name takes the bare one', async () => {
  const side = await readSide({
    readers: [
      fakeReader({
        roots: [
          { root: 'a', name: 'web' },
          { root: 'b', name: 'web' },
        ],
        holds: ({ root }) => root === 'b',
      }),
    ],
  });

  expect(drawnStacks(side)).toEqual([{ root: 'b', stack: 'web' }]);
});

test('whether a root holds a stack is asked with the settings of the id it would take', async () => {
  const side = await readSide({
    config: '{"stacks": {"web~2": {"sourceRoot": "app"}}}',
    readers: [
      fakeReader({
        roots: [
          { root: 'a', name: 'web' },
          { root: 'b', name: 'web' },
        ],
        holds: ({ root, settings }) => root === 'a' || settings.sourceRoot === 'app',
      }),
    ],
  });

  expect(drawnStacks(side)).toEqual([
    { root: 'a', stack: 'web' },
    { root: 'b', stack: 'web~2' },
  ]);
});

test("a reader's graph is given the roots and ids of its own stacks, not another reader's", async () => {
  const side = await readSide({
    readers: [
      fakeReader({ name: 'rust', roots: [{ root: 'api' }] }),
      fakeReader({
        name: 'typescript',
        roots: [{ root: 'web' }],
        graph: async ({ stack, stacks }) => ({
          nodes: [
            {
              id: stack,
              kind: 'stack',
              label: [...stacks].map(([root, id]) => `${root}=${id}`).join(','),
              path: '',
            },
          ],
          edges: [],
        }),
      }),
    ],
  });

  expect(side.graph.nodes.map(({ label }) => label)).toEqual(['api', 'web=web']);
});
