import { expect, test } from 'vitest';
import type { DiffedEdge, DiffedNode, GraphDiff } from './diff-graphs.ts';
import type { Note } from './notes.ts';
import { nearChanges, visibleDiff, visibleNotes } from './visible-diff.ts';

const node = (id: string, kind: DiffedNode['kind'], parent?: string): DiffedNode => ({
  id,
  kind,
  label: id,
  path: id,
  state: 'unchanged',
  ...(parent === undefined ? {} : { parent }),
});

const nested = (edges: ReadonlyArray<DiffedEdge>): GraphDiff => ({
  nodes: [
    node('web', 'stack'),
    node('A', 'module', 'web'),
    node('B', 'module', 'web'),
    node('a1', 'file', 'A'),
    node('a2', 'file', 'A'),
    node('b1', 'file', 'B'),
    node('root', 'file', 'web'),
  ],
  edges,
});

test.for<{
  readonly rule: string;
  readonly edges: ReadonlyArray<DiffedEdge>;
  readonly drawn: ReadonlyArray<DiffedEdge>;
}>([
  {
    rule: 'merges file edges between two modules into one added edge when all were added',
    edges: [
      { from: 'a1', to: 'b1', state: 'added' },
      { from: 'a2', to: 'b1', state: 'added' },
    ],
    drawn: [{ from: 'A', to: 'B', state: 'added' }],
  },
  {
    rule: 'draws a removed module edge when every file edge under it was removed',
    edges: [
      { from: 'a1', to: 'b1', state: 'removed' },
      { from: 'a2', to: 'b1', state: 'removed' },
    ],
    drawn: [{ from: 'A', to: 'B', state: 'removed' }],
  },
  {
    rule: 'draws an unchanged module edge when its file edges were both added and removed',
    edges: [
      { from: 'a1', to: 'b1', state: 'added' },
      { from: 'a2', to: 'b1', state: 'removed' },
    ],
    drawn: [{ from: 'A', to: 'B', state: 'unchanged' }],
  },
  {
    rule: 'keeps the edges from one module to two others apart',
    edges: [
      { from: 'a1', to: 'b1', state: 'added' },
      { from: 'a2', to: 'root', state: 'removed' },
    ],
    drawn: [
      { from: 'A', to: 'B', state: 'added' },
      { from: 'A', to: 'root', state: 'removed' },
    ],
  },
  {
    rule: 'joins the paths of the calls merged into one call edge, each once',
    edges: [
      { from: 'a1', to: 'root', via: ['/api/users'], state: 'added' },
      { from: 'a2', to: 'root', via: ['/api/sessions', '/api/users'], state: 'added' },
    ],
    drawn: [{ from: 'A', to: 'root', via: ['/api/users', '/api/sessions'], state: 'added' }],
  },
  {
    rule: 'drops an edge between two files of the same module',
    edges: [{ from: 'a1', to: 'a2', state: 'added' }],
    drawn: [],
  },
])('$rule', ({ edges, drawn }) => {
  expect(visibleDiff({ diff: nested(edges), expanded: new Set() }).edges).toEqual(drawn);
});

test.for<{
  readonly rule: string;
  readonly notes: Readonly<Record<string, Note>>;
  readonly shown: Readonly<Record<string, Note>>;
}>([
  {
    rule: 'shows a note on a hidden file edge on the module edge it merges into, and keeps node notes',
    notes: {
      'a1 -> b1': { text: 'Reads b1.', flag: 'reaches in' },
      a1: { text: 'Changed.' },
    },
    shown: {
      'A -> B': { text: 'Reads b1.', flag: 'reaches in' },
      a1: { text: 'Changed.' },
    },
  },
  {
    rule: 'joins the notes and the flags of the file edges merged into one drawn edge',
    notes: {
      'a1 -> b1': { text: 'Reads b1.', flag: 'reaches in' },
      'a2 -> b1': { text: 'Also reads b1.', flag: 'cycle' },
      'a2 -> root': { text: 'Calls root.' },
    },
    shown: {
      'A -> B': { text: 'Reads b1. Also reads b1.', flag: 'reaches in, cycle' },
      'A -> root': { text: 'Calls root.' },
    },
  },
  {
    rule: 'keeps the one flag among merged notes',
    notes: {
      'a1 -> b1': { text: 'Reads b1.' },
      'a2 -> b1': { text: 'Also reads b1.', flag: 'cycle' },
    },
    shown: { 'A -> B': { text: 'Reads b1. Also reads b1.', flag: 'cycle' } },
  },
  {
    rule: 'gives merged notes without flags no flag',
    notes: {
      'a1 -> b1': { text: 'Reads b1.' },
      'a2 -> b1': { text: 'Also reads b1.' },
    },
    shown: { 'A -> B': { text: 'Reads b1. Also reads b1.' } },
  },
])('$rule', ({ notes, shown }) => {
  const diff = nested([
    { from: 'a1', to: 'b1', state: 'added' },
    { from: 'a2', to: 'b1', state: 'added' },
    { from: 'a2', to: 'root', state: 'added' },
  ]);
  expect(visibleNotes({ diff, expanded: new Set(), notes })).toEqual(shown);
});

const changed = (base: DiffedNode): DiffedNode => ({ ...base, state: 'modified' });

test.for<{
  readonly rule: string;
  readonly diff: GraphDiff;
  readonly kept: ReadonlyArray<string>;
  readonly keptEdges: ReadonlyArray<string>;
}>([
  {
    rule: 'keeps a changed node and its neighbours either way, with the edges between them, and hides the rest and an emptied stack',
    diff: {
      nodes: [
        node('rust', 'stack'),
        node('domain', 'package', 'rust'),
        node('application', 'package', 'rust'),
        changed(node('http-adapter', 'package', 'rust')),
        node('cli-adapter', 'package', 'rust'),
        node('shop', 'package', 'rust'),
        node('web', 'stack'),
        node('W', 'module', 'web'),
      ],
      edges: [
        { from: 'application', to: 'domain', state: 'unchanged' },
        { from: 'http-adapter', to: 'application', state: 'unchanged' },
        { from: 'http-adapter', to: 'domain', state: 'unchanged' },
        { from: 'cli-adapter', to: 'application', state: 'unchanged' },
        { from: 'shop', to: 'http-adapter', state: 'unchanged' },
        { from: 'shop', to: 'cli-adapter', state: 'unchanged' },
      ],
    },
    kept: ['rust', 'domain', 'application', 'http-adapter', 'shop'],
    keptEdges: [
      'application -> domain',
      'http-adapter -> application',
      'http-adapter -> domain',
      'shop -> http-adapter',
    ],
  },
  {
    rule: 'keeps both ends of an added edge between unchanged nodes, and not their other neighbours',
    diff: {
      nodes: [
        node('rust', 'stack'),
        node('a', 'package', 'rust'),
        node('b', 'package', 'rust'),
        node('c', 'package', 'rust'),
      ],
      edges: [
        { from: 'a', to: 'b', state: 'added' },
        { from: 'b', to: 'c', state: 'unchanged' },
      ],
    },
    kept: ['rust', 'a', 'b'],
    keptEdges: ['a -> b'],
  },
  {
    rule: 'keeps the expanded module and stack around a kept file',
    diff: {
      nodes: [
        node('web', 'stack'),
        node('A', 'module', 'web'),
        changed(node('a1', 'file', 'A')),
        node('a2', 'file', 'A'),
        node('B', 'module', 'web'),
      ],
      edges: [],
    },
    kept: ['web', 'A', 'a1'],
    keptEdges: [],
  },
  {
    rule: 'counts a call across the stacks as a hop',
    diff: {
      nodes: [
        node('web', 'stack'),
        node('A', 'module', 'web'),
        node('rust', 'stack'),
        changed(node('http-adapter', 'package', 'rust')),
      ],
      edges: [{ from: 'A', to: 'http-adapter', via: ['/api/info'], state: 'unchanged' }],
    },
    kept: ['web', 'A', 'rust', 'http-adapter'],
    keptEdges: ['A -> http-adapter'],
  },
])('changed + 1 hop $rule', ({ diff, kept, keptEdges }) => {
  const near = nearChanges(diff);

  expect(near.nodes.map(({ id }) => id)).toEqual(kept);
  expect(near.edges.map(({ from, to }) => `${from} -> ${to}`)).toEqual(keptEdges);
});
