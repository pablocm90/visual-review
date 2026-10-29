import { expect, test, vi } from 'vitest';
import { fakeLinker, fakeReader } from '../test-support/fakes.ts';
import { parseConfig } from './config.ts';
import type { Graph } from './graph.ts';
import type { Linker } from './linker.ts';
import { checkConfig, readStacks } from './read-stacks.ts';
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
  readonly linkers?: ReadonlyArray<Linker>;
  readonly onPath?: (command: string) => boolean;
  readonly config?: string;
};

const readSide = ({ readers, linkers = [], onPath = () => true, config = '{}' }: SideOptions) =>
  readStacks({
    directory: '/checkout',
    repoName: 'shop',
    config: parseConfig(config),
    readers,
    linkers,
    onPath,
  });

const drawnStacks = (side: Awaited<ReturnType<typeof readSide>>) =>
  side.stacks.map(({ root, stack }) => ({ root, stack }));

const nodeIds = (graph: Graph) => graph.nodes.map(({ id }) => id);

const bothSides = (side: Awaited<ReturnType<typeof readSide>>) => [...side.stacks, ...side.stacks];

const unread: Reader['graph'] = async () => {
  throw new Error('a graph was read');
};

const apiAndWeb = (): ReadonlyArray<Reader> => [
  fakeReader({ name: 'rust', roots: [{ root: 'api' }, { root: 'jobs' }] }),
  fakeReader({
    name: 'typescript',
    roots: [{ root: 'web' }, { root: 'admin' }, { root: 'e2e' }],
  }),
];

test('readers each finding the repo root draw it under the repo name and then the first suffixes free, in reader order', async () => {
  const side = await readSide({
    readers: [
      fakeReader({ name: 'rust', roots: [{ root: '.' }] }),
      fakeReader({ name: 'typescript', roots: [{ root: '.' }] }),
      fakeReader({ name: 'rails', roots: [{ root: '.' }] }),
    ],
  });

  expect(drawnStacks(side)).toEqual([
    { root: '.', stack: 'shop' },
    { root: '.', stack: 'shop~2' },
    { root: '.', stack: 'shop~3' },
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
  const graph = vi.fn<Reader['graph']>(async ({ root, stack }) => ({
    nodes: [{ id: stack, kind: 'stack', label: stack, path: root }],
    edges: [],
  }));
  await readSide({
    readers: [
      fakeReader({ name: 'rust', roots: [{ root: 'api' }] }),
      fakeReader({ name: 'typescript', roots: [{ root: 'web' }], graph }),
    ],
  });

  expect(graph).toHaveBeenCalledWith(
    expect.objectContaining({ stacks: new Map([['web', 'web']]) }),
  );
});

test("a stack's graph is read with the settings of the id it is drawn under", async () => {
  const side = await readSide({
    config: '{"stacks": {"shop~2": {"boxes": ["modules/*"]}}}',
    readers: [
      fakeReader({ name: 'rust', roots: [{ root: '.' }] }),
      fakeReader({
        name: 'typescript',
        roots: [{ root: '.' }],
        graph: async ({ stack, settings }) => ({
          nodes: [{ id: stack, kind: 'stack', label: String(settings.boxes), path: '' }],
          edges: [],
        }),
      }),
    ],
  });

  expect(side.graph.nodes).toContainEqual(
    expect.objectContaining({ id: 'shop~2', label: 'modules/*' }),
  );
});

const withE2eDropped = () =>
  readSide({
    config: '{"stacks": {"e2e": false}}',
    readers: [
      fakeReader({
        roots: [{ root: 'web' }, { root: 'e2e' }],
        graph: async ({ root, stack }) => {
          if (root === 'e2e') throw new Error('e2e was read');
          return {
            nodes: [{ id: stack, kind: 'stack', label: stack, path: root }],
            edges: [{ from: stack, to: 'e2e' }],
          };
        },
      }),
    ],
  });

test('a stack the config sets to false is not read, and edges to it go', async () => {
  const side = await withE2eDropped();

  expect(side.graph).toEqual({
    nodes: [{ id: 'web', kind: 'stack', label: 'web', path: 'web' }],
    edges: [],
  });
});

test('a stack the config sets to false is no test root, but still counts as drawn', async () => {
  const side = await withE2eDropped();

  expect(side.roots.map(({ root }) => root)).toEqual(['web']);
  expect(drawnStacks(side)).toEqual([
    { root: 'web', stack: 'web' },
    { root: 'e2e', stack: 'e2e' },
  ]);
});

test("a stack's label from the config replaces its drawn label, its id and its other nodes' labels kept", async () => {
  const side = await readSide({
    config: '{"stacks": {"shop": {"label": "Shop"}}}',
    readers: [fakeReader({ roots: [{ root: '.' }], graph: async () => shopGraph() })],
  });

  expect(side.graph.nodes.map(({ id, label }) => [id, label])).toEqual([
    ['shop', 'Shop'],
    ['shop/class/User', 'User'],
    ['shop/class/Order', 'Order'],
  ]);
});

test('an edge with an end no stack draws is dropped', async () => {
  const side = await readSide({
    readers: [
      fakeReader({
        roots: [{ root: '.' }],
        graph: async () => ({
          ...shopGraph(),
          edges: [
            { from: 'shop/class/Order', to: 'shop/class/User' },
            { from: 'shop/class/Order', to: 'gone' },
            { from: 'gone', to: 'shop/class/User' },
          ],
        }),
      }),
    ],
  });

  expect(side.graph.edges).toEqual([{ from: 'shop/class/Order', to: 'shop/class/User' }]);
});

test('a reader whose tool is not on PATH reads none of its stacks and is listed as skipped with those the config keeps, while other readers still read theirs', async () => {
  const side = await readSide({
    config: '{"stacks": {"jobs": false}}',
    onPath: command => command !== 'cargo',
    readers: [
      fakeReader({
        name: 'rust',
        tool: 'cargo',
        roots: [{ root: 'api' }, { root: 'jobs' }],
        graph: unread,
      }),
      fakeReader({ name: 'typescript', tool: 'node', roots: [{ root: 'web' }] }),
    ],
  });

  expect(nodeIds(side.graph)).toEqual(['web']);
  expect(side.skipped).toEqual([{ reader: 'rust', tool: 'cargo', stacks: ['api'] }]);
});

test.for([
  {
    reason: 'whose stacks the config all drops',
    config: '{"stacks": {"api": false}}',
    holds: true,
  },
  { reason: 'that holds no stack', config: '{}', holds: false },
])('a reader $reason is not skipped without its tool', async ({ config, holds }) => {
  const side = await readSide({
    config,
    onPath: () => false,
    readers: [
      fakeReader({ name: 'rust', tool: 'cargo', roots: [{ root: 'api' }], holds: () => holds }),
    ],
  });

  expect(side.skipped).toEqual([]);
});

test('a linker is given every stack the config keeps of its from reader and of its to reader, each with its own nodes, and its edges and dangling calls are drawn', async () => {
  const side = await readSide({
    config: '{"stacks": {"e2e": false}}',
    readers: apiAndWeb(),
    linkers: [fakeLinker({ from: 'typescript', to: 'rust' })],
  });

  expect(side.graph.edges).toEqual([
    { from: 'web', to: 'api' },
    { from: 'web', to: 'jobs' },
    { from: 'admin', to: 'api' },
    { from: 'admin', to: 'jobs' },
  ]);
  expect(side.danglingCalls).toEqual([
    { from: 'web', path: '/missing' },
    { from: 'admin', path: '/missing' },
  ]);
});

test.for([
  {
    reason: 'from one stack',
    linker: { from: ['admin'] },
    edges: [
      { from: 'admin', to: 'api' },
      { from: 'admin', to: 'jobs' },
    ],
  },
  {
    reason: 'to one stack',
    linker: { to: ['jobs'] },
    edges: [
      { from: 'web', to: 'jobs' },
      { from: 'admin', to: 'jobs' },
      { from: 'e2e', to: 'jobs' },
    ],
  },
  { reason: 'off', linker: false, edges: [] },
])('a linker the config sets $reason links only what it names', async ({ linker, edges }) => {
  const side = await readSide({
    config: JSON.stringify({ linkers: { 'fetch-axum': linker } }),
    readers: apiAndWeb(),
    linkers: [fakeLinker({ from: 'typescript', to: 'rust' })],
  });

  expect(side.graph.edges).toEqual(edges);
});

test("a config stack with a reader and a root is drawn under its key where its reader holds it, and later readers' stacks are told apart from it", async () => {
  const side = await readSide({
    config:
      '{"stacks": {"gen": {"reader": "rails", "root": "tools/gen"}, "old": {"reader": "rails", "root": "tools/old"}}}',
    readers: [
      fakeReader({ name: 'rails', roots: [], holds: ({ root }) => root === 'tools/gen' }),
      fakeReader({ name: 'typescript', roots: [{ root: 'gen' }] }),
    ],
  });

  expect(drawnStacks(side)).toEqual([
    { root: 'tools/gen', stack: 'gen' },
    { root: 'gen', stack: 'gen~2' },
  ]);
});

test.for([
  {
    reason: 'at a root its reader detects, however the root is written',
    config: { front: { reader: 'rails', root: './web/' } },
    readers: [fakeReader({ roots: [{ root: 'web' }], graph: unread })],
    error: 'stacks.front.root: ./web/ is detected as stack web; set stacks.web instead',
  },
  {
    reason: 'under the id its reader detects a stack under',
    config: { shop: { reader: 'rails', root: 'app' } },
    readers: [fakeReader({ roots: [{ root: '.' }], graph: unread })],
    error:
      'stacks.shop is detected at .; add the stack under another key, or drop its reader and root',
  },
  {
    reason: "under the id of an earlier reader's stack",
    config: { shop: { reader: 'rails', root: 'app' } },
    readers: [
      fakeReader({ name: 'rust', roots: [{ root: '.' }], graph: unread }),
      fakeReader({ roots: [], graph: unread }),
    ],
    error:
      'stacks.shop is drawn by another reader; add the stack under another key, or drop its reader and root',
  },
])(
  'a config stack added $reason fails before any graph is read',
  async ({ config, readers, error }) => {
    await expect(readSide({ config: JSON.stringify({ stacks: config }), readers })).rejects.toThrow(
      new Error(`visual-review.config.json: ${error}`),
    );
  },
);

test.for([
  {
    reason: 'a stack drawn by no reader',
    config: { stacks: { wbe: { label: 'Web' } } },
    error: 'stacks.wbe names no detected stack; give it reader and root to add one',
  },
  {
    reason: 'an added stack its reader holds at neither side',
    config: { stacks: { gen: { reader: 'rails', root: 'tools/gen' } } },
    error: 'stacks.gen.root: tools/gen holds no rails stack on either side',
  },
  {
    reason: "a field the stack's reader does not take, once for both sides",
    config: { stacks: { web: { boxes: ['*'], sourceRoot: 'lib' } } },
    error: 'stacks.web.boxes is not taken by the typescript reader',
  },
  {
    reason: 'a linker reading from no stack of its from reader',
    config: { linkers: { 'fetch-axum': { from: ['api'] } } },
    error: 'linkers.fetch-axum.from: api names no typescript stack on either side',
  },
  {
    reason: 'a linker linking to no stack of its to reader',
    config: { linkers: { 'fetch-axum': { to: ['web'] } } },
    error: 'linkers.fetch-axum.to: web names no rust stack on either side',
  },
  {
    reason: 'a linker naming a dropped stack',
    config: { stacks: { web: false }, linkers: { 'fetch-axum': { from: ['web'] } } },
    error: 'linkers.fetch-axum.from: web is dropped by stacks.web',
  },
])('a config naming $reason fails the check', async ({ config, error }) => {
  const readers = [
    fakeReader({ name: 'rust', roots: [{ root: 'api' }] }),
    fakeReader({ name: 'typescript', stackFields: ['sourceRoot'], roots: [{ root: 'web' }] }),
    fakeReader({ name: 'rails', roots: [], holds: () => false }),
  ];
  const linkers = [fakeLinker({ from: 'typescript', to: 'rust' })];
  const side = await readSide({ config: JSON.stringify(config), readers, linkers });

  expect(() => checkConfig(parseConfig(JSON.stringify(config)), bothSides(side), linkers)).toThrow(
    new Error(`visual-review.config.json: ${error}`),
  );
});

test('a config naming drawn stacks, by fields their readers take, its own fields and linkers reading them, passes the check', async () => {
  const config =
    '{"stacks": {"web": {"label": "Web", "sourceRoot": "lib"}, "gen": {"reader": "rails", "root": "tools/gen"}}, "linkers": {"fetch-axum": {"from": ["web"], "to": ["api"]}}}';
  const readers = [
    fakeReader({ name: 'rust', roots: [{ root: 'api' }] }),
    fakeReader({ name: 'typescript', stackFields: ['sourceRoot'], roots: [{ root: 'web' }] }),
    fakeReader({ name: 'rails', roots: [] }),
  ];
  const linkers = [fakeLinker({ from: 'typescript', to: 'rust' })];
  const side = await readSide({ config, readers, linkers });

  expect(() => checkConfig(parseConfig(config), side.stacks, linkers)).not.toThrow();
});
