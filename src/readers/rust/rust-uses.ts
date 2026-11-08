import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Node } from 'web-tree-sitter';
import type { GraphNode } from '../../core/graph.ts';
import type { SymbolUse, UsesAsked, UsesReading } from '../../core/reader.ts';
import { parseRust } from './rust-syntax.ts';

type Segments = ReadonlyArray<string>;

const PATHS: ReadonlySet<string> = new Set(['scoped_identifier', 'scoped_type_identifier']);

const segmentsOf = (node: Node | null): Segments => {
  if (node === null) return [];
  if (!PATHS.has(node.type)) return [node.text];
  return [
    ...segmentsOf(node.childForFieldName('path')),
    node.childForFieldName('name')?.text ?? '',
  ];
};

type Imported = { readonly segments: Segments; readonly local: Segments };

const importedOf = (segments: Segments, local: Segments = segments.slice(-1)): Imported => ({
  segments,
  local,
});

const importsInUse = (node: Node): ReadonlyArray<Imported> => {
  if (node.type === 'use_list') return node.namedChildren.flatMap(importsInUse);
  if (node.type === 'use_as_clause')
    return [
      importedOf(
        segmentsOf(node.childForFieldName('path')),
        segmentsOf(node.childForFieldName('alias')),
      ),
    ];
  if (node.type === 'use_wildcard') return [importedOf(segmentsOf(node.namedChild(0)), [])];
  if (node.type === 'scoped_use_list') {
    const prefix = segmentsOf(node.childForFieldName('path'));
    const list = node.childForFieldName('list');
    return (list === null ? [] : importsInUse(list)).map(({ segments, local }) =>
      importedOf([...prefix, ...segments], local),
    );
  }
  return [importedOf(segmentsOf(node))];
};

const startOf = (from: Segments, first: string, extern: string): Segments => {
  if (first === 'crate') return from.slice(0, 1);
  if (first === extern) return [first];
  if (first === 'self') return from;
  if (first === 'super') return from.slice(0, -1);
  return [...from, first];
};

const absoluteFrom = (from: Segments, extern: string, [first = '', ...rest]: Segments): Segments =>
  rest.reduce<Segments>(
    (at, segment) => (segment === 'super' ? at.slice(0, -1) : at.concat(segment)),
    startOf(from, first, extern),
  );

const importsIn = (root: Node, from: Segments, extern: string): ReadonlyArray<Imported> =>
  root
    .descendantsOfType('use_declaration')
    .flatMap(declaration => {
      const argument = declaration.childForFieldName('argument');
      return argument === null ? [] : importsInUse(argument);
    })
    .map(({ segments, local }) => importedOf(absoluteFrom(from, extern, segments), local));

const isInUse = (node: Node): boolean =>
  node.parent !== null && (node.parent.type === 'use_declaration' || isInUse(node.parent));

const namesItsParent = (node: Node): boolean =>
  node.parent?.type !== 'struct_expression' &&
  node.parent?.childForFieldName('name')?.id === node.id;

const isPrefix = (prefix: Segments, of: Segments): boolean =>
  prefix.every((segment, index) => segment === of[index]);

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
    const imported = importsIn(root, from, target[0] ?? '');
    const lines = text.split('\n');
    const paths = root
      .descendantsOfType(['identifier', 'type_identifier', ...PATHS])
      .filter(node => !isInUse(node) && !namesItsParent(node));
    return new Map(
      names.map(name => {
        const item = [...target, ...name.split('::')];
        const forms = new Set(
          imported
            .filter(({ segments }) => isPrefix(segments, item))
            .map(({ segments, local }) => [...local, ...item.slice(segments.length)].join('::')),
        );
        const first = paths.find(node => forms.has(segmentsOf(node).join('::')));
        if (first === undefined) return [name, []];
        const row = first.startPosition.row;
        return [name, [{ path, line: row + 1, text: (lines[row] ?? '').trim() }]];
      }),
    );
  } finally {
    root.tree.delete();
  }
};

export const usesOfRust = async ({ head, graph, node, names }: UsesAsked): Promise<UsesReading> => {
  const nodeOf = (id: string | undefined) => graph.nodes.find(candidate => candidate.id === id);
  const segmentsOfModule = ({ label, parent }: Pick<GraphNode, 'label' | 'parent'>): Segments => [
    (nodeOf(parent)?.label ?? '').replaceAll('-', '_'),
    ...(label.endsWith('.rs') ? [] : label.split('::')),
  ];
  const asked: Pick<GraphNode, 'label' | 'parent'> = nodeOf(node.id) ?? { label: '' };
  const target = segmentsOfModule(asked);
  const dependents = new Set<string | undefined>(
    graph.edges.filter(({ to }) => to === asked.parent).map(({ from }) => from),
  );
  const files = [
    ...graph.edges.filter(({ to }) => to === node.id).flatMap(({ from }) => nodeOf(from) ?? []),
    ...graph.nodes.filter(({ parent }) => dependents.has(parent)),
  ].map(module =>
    rowsIn(
      {
        path: module.path,
        text: readFileSync(join(head, module.path), 'utf8'),
        from: segmentsOfModule(module),
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
