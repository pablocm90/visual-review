import { expect, test } from 'vitest';
import type { DiffedEdge, DiffedNode, GraphDiff } from './diff-graphs.ts';
import { readingOrder } from './reading-order.ts';
import { splitSuggestion } from './split-suggestion.ts';

const id = (name: string) => `web/file/${name}`;

const file = (name: string, state: DiffedNode['state'] = 'modified'): DiffedNode => ({
  id: id(name),
  kind: 'file',
  label: name,
  path: `web/src/${name}`,
  parent: 'web',
  state,
});

const edge = (from: string, to: string, state: DiffedEdge['state'] = 'unchanged'): DiffedEdge => ({
  from: id(from),
  to: id(to),
  state,
});

const stack: DiffedNode = { id: 'web', kind: 'stack', label: 'web', path: '', state: 'modified' };

const chainOf = (names: ReadonlyArray<string>) => ({
  nodes: names.map(name => file(name)),
  edges: names.slice(1).map((name, index) => edge(names[index] ?? '', name)),
});

const a = {
  nodes: ['a1', 'a2', 'a3', 'a4'].map(name => file(name)),
  edges: [edge('a1', 'a2'), edge('a1', 'a3'), edge('a2', 'a4')],
};
const b = chainOf(['b1', 'b2', 'b3', 'b4']);

const suggestionFor = (diff: GraphDiff, splitParts = 4) =>
  splitSuggestion({
    parts: readingOrder({ ...diff, nodes: [stack, ...diff.nodes] }).parts,
    edges: diff.edges,
    splitParts,
  });

test('parts with no edge between them fall into separate groups, each in reading order', () => {
  expect(
    suggestionFor({ nodes: [...a.nodes, ...b.nodes], edges: [...a.edges, ...b.edges] })?.groups,
  ).toEqual([
    [id('a3'), id('a4'), id('a2'), id('a1')],
    [id('b4'), id('b3'), id('b2'), id('b1')],
  ]);
});

test.for(['added', 'removed', 'unchanged'] as const)(
  'one %s edge between changed parts joins their groups, so nothing is suggested',
  state => {
    expect(
      suggestionFor({
        nodes: [...a.nodes, ...b.nodes],
        edges: [...a.edges, ...b.edges, edge('a1', 'b1', state)],
      }),
    ).toBeUndefined();
  },
);

test('a group of 4 and a group of 3 suggest nothing at 4 parts, and both at 3', () => {
  const short = chainOf(['b1', 'b2', 'b3']);
  const diff = { nodes: [...a.nodes, ...short.nodes], edges: [...a.edges, ...short.edges] };

  expect(suggestionFor(diff)).toBeUndefined();
  expect(suggestionFor(diff, 3)?.groups).toEqual([
    [id('a3'), id('a4'), id('a2'), id('a1')],
    [id('b3'), id('b2'), id('b1')],
  ]);
});

test('a smaller group is left out of the groups and counted by its parts', () => {
  const pair = chainOf(['c1', 'c2']);

  expect(
    suggestionFor({
      nodes: [...a.nodes, ...b.nodes, ...pair.nodes, file('d1')],
      edges: [...a.edges, ...b.edges, ...pair.edges],
    }),
  ).toEqual({
    groups: [
      [id('a3'), id('a4'), id('a2'), id('a1')],
      [id('b4'), id('b3'), id('b2'), id('b1')],
    ],
    leftOut: 3,
  });
});

test('parts tied only through an unchanged file still fall apart', () => {
  expect(
    suggestionFor({
      nodes: [...a.nodes, ...b.nodes, file('shared', 'unchanged')],
      edges: [...a.edges, ...b.edges, edge('a1', 'shared'), edge('b1', 'shared')],
    })?.groups,
  ).toHaveLength(2);
});

test('a changed box with a changed part inside counts once, as that part', () => {
  const box: DiffedNode = {
    id: 'web/box/lib',
    kind: 'module',
    label: 'lib',
    path: 'web/src/lib',
    parent: 'web',
    state: 'modified',
  };
  const inBox = ['a1', 'a2', 'a3', 'a4'].map(name => ({ ...file(name), parent: box.id }));

  const suggestion = suggestionFor({
    nodes: [box, ...inBox, ...b.nodes],
    edges: [...a.edges, ...b.edges],
  });

  expect(suggestion?.groups[0]).toEqual([id('a3'), id('a4'), id('a2'), id('a1')]);
  expect(suggestion?.leftOut).toBe(0);
});

test('parts sharing a changed box with no edge between them stay apart', () => {
  const box: DiffedNode = {
    id: 'web/box/lib',
    kind: 'module',
    label: 'lib',
    path: 'web/src/lib',
    parent: 'web',
    state: 'modified',
  };
  const under = (node: DiffedNode) => ({ ...node, parent: box.id });

  expect(
    suggestionFor({
      nodes: [box, ...a.nodes.map(under), ...b.nodes.map(under)],
      edges: [...a.edges, ...b.edges],
    })?.groups,
  ).toHaveLength(2);
});

test('a removed part joins its group through a removed edge', () => {
  expect(
    suggestionFor({
      nodes: [...a.nodes, file('gone', 'removed'), ...b.nodes],
      edges: [...a.edges, ...b.edges, edge('a1', 'gone', 'removed')],
    })?.groups[0],
  ).toEqual([id('a3'), id('a4'), id('a2'), id('a1'), id('gone')]);
});
