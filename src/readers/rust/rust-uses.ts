import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Node } from 'web-tree-sitter';
import type { GraphNode } from '../../core/graph.ts';
import type { SymbolUse, UsesAsked, UsesReading } from '../../core/reader.ts';
import { parseRust } from './rust-syntax.ts';

type Segments = ReadonlyArray<string>;

const segmentsOf = (node: Node | null): Segments => {
  if (node === null) return [];
  if (node.type !== 'scoped_identifier') return [node.text];
  return [
    ...segmentsOf(node.childForFieldName('path')),
    node.childForFieldName('name')?.text ?? '',
  ];
};

const pathsInUse = (node: Node): ReadonlyArray<Segments> => {
  if (node.type === 'use_list') return node.namedChildren.flatMap(pathsInUse);
  if (node.type === 'scoped_use_list') {
    const prefix = segmentsOf(node.childForFieldName('path'));
    const list = node.childForFieldName('list');
    return (list === null ? [] : pathsInUse(list)).map(path => [...prefix, ...path]);
  }
  return [segmentsOf(node)];
};

const startOf = (from: Segments, first: string): Segments => {
  if (first === 'crate') return [];
  if (first === 'self') return from;
  if (first === 'super') return from.slice(0, -1);
  return [...from, first];
};

const absoluteFrom = (from: Segments, [first = '', ...rest]: Segments): Segments =>
  rest.reduce<Segments>(
    (at, segment) => (segment === 'super' ? at.slice(0, -1) : at.concat(segment)),
    startOf(from, first),
  );

const moduleSegments = ({ label }: Pick<GraphNode, 'label'>): Segments =>
  label.endsWith('.rs') ? [] : label.split('::');

const importsIn = (root: Node, from: Segments): ReadonlyArray<string> =>
  root
    .descendantsOfType('use_declaration')
    .flatMap(declaration => {
      const argument = declaration.childForFieldName('argument');
      return argument === null ? [] : pathsInUse(argument);
    })
    .map(path => absoluteFrom(from, path).join('::'));

const isInUse = (node: Node): boolean =>
  node.parent !== null && (node.parent.type === 'use_declaration' || isInUse(node.parent));

type Candidate = {
  readonly path: string;
  readonly text: string;
  readonly from: Segments;
};

const rowsIn = (
  { path, text, from }: Candidate,
  target: Segments,
  names: ReadonlyArray<string>,
): ReadonlyMap<string, ReadonlyArray<SymbolUse>> => {
  const root = parseRust(text);
  if (root === undefined) return new Map();
  try {
    const imported = new Set(importsIn(root, from));
    const lines = text.split('\n');
    const identifiers = root.descendantsOfType('identifier').filter(node => !isInUse(node));
    return new Map(
      names.map(name => {
        const first = identifiers.find(node => node.text === name);
        if (!imported.has([...target, name].join('::')) || first === undefined) return [name, []];
        const row = first.startPosition.row;
        return [name, [{ path, line: row + 1, text: (lines[row] ?? '').trim() }]];
      }),
    );
  } finally {
    root.tree.delete();
  }
};

export const usesOfRust = async ({ head, graph, node, names }: UsesAsked): Promise<UsesReading> => {
  const target = moduleSegments(graph.nodes.find(({ id }) => id === node.id) ?? { label: '' });
  const files = graph.edges
    .filter(({ to }) => to === node.id)
    .flatMap(({ from }) => graph.nodes.find(({ id }) => id === from) ?? [])
    .map(module =>
      rowsIn(
        {
          path: module.path,
          text: readFileSync(join(head, module.path), 'utf8'),
          from: moduleSegments(module),
        },
        target,
        names,
      ),
    );
  return {
    uses: Object.fromEntries(
      names.map(name => [name, files.flatMap(rows => rows.get(name) ?? [])]),
    ),
    notRead: [],
    notFollowed: [],
  };
};
