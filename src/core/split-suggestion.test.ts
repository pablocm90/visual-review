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

const a = chainOf(['a1', 'a2', 'a3', 'a4']);
const b = chainOf(['b1', 'b2', 'b3', 'b4']);

const suggestionFor = (diff: GraphDiff) =>
  splitSuggestion({
    parts: readingOrder({ ...diff, nodes: [stack, ...diff.nodes] }).parts,
    edges: diff.edges,
  });

test('parts with no edge between them fall into separate groups, each in reading order', () => {
  expect(
    suggestionFor({ nodes: [...a.nodes, ...b.nodes], edges: [...a.edges, ...b.edges] })?.groups,
  ).toEqual([
    [id('a4'), id('a3'), id('a2'), id('a1')],
    [id('b4'), id('b3'), id('b2'), id('b1')],
  ]);
});
