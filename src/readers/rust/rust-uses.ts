import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Node } from 'web-tree-sitter';
import type { GraphNode } from '../../core/graph.ts';
import type { SymbolUse, UsesAsked, UsesReading } from '../../core/reader.ts';
import { isTestCode, parseRust, TEST_FOLDER } from './rust-syntax.ts';
import {
  EXTERN_PRELUDE,
  followed,
  type Imported,
  importedOf,
  importsInUse,
  PATHS,
  type Segments,
  segmentsOf,
} from './use-paths.ts';

const startOf = (from: Segments, first: string, extern: string): Segments => {
  if (first === EXTERN_PRELUDE) return [];
  if (first === 'crate') return from.slice(0, 1);
  if (first === extern) return [first];
  if (first === 'self') return from;
  if (first === 'super') return from.slice(0, -1);
  return [...from, first];
};

const absoluteFrom = (from: Segments, extern: string, [first = '', ...rest]: Segments): Segments =>
  followed(startOf(from, first, extern), rest);

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
    const formsIn =
      (imports: ReadonlyArray<Imported>) =>
      (item: Segments): ReadonlySet<string> =>
        new Set(
          imports
            .filter(({ segments }) => isPrefix(segments, item))
            .map(({ segments, local }) => [...local, ...item.slice(segments.length)].join('::')),
        );
    const formsOf = formsIn(imported);
    const writtenFormsOf = formsIn([
      ...imported,
      importedOf(target.slice(0, 1)),
      importedOf(from.slice(0, 1), ['crate']),
    ]);
    const fields = root
      .descendantsOfType('field_identifier')
      .filter(node => node.parent?.type === 'field_expression');
    return new Map(
      names.map(name => {
        const item = [...target, ...name.split(/::|\./)];
        const forms = writtenFormsOf(item);
        const calls =
          name.includes('.') && formsOf(item.slice(0, -1)).size > 0
            ? fields.filter(node => node.text === item.at(-1))
            : [];
        const [first] = [
          ...paths.filter(node => forms.has(segmentsOf(node).join('::'))),
          ...calls,
        ].toSorted((one, other) => one.startIndex - other.startIndex);
        if (first === undefined) return [name, []];
        const row = first.startPosition.row;
        return [
          name,
          [
            {
              path,
              line: row + 1,
              text: (lines[row] ?? '').trim(),
              test: TEST_FOLDER.test(path) || isTestCode(first),
            },
          ],
        ];
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
    notFollowed: names.some(name => name.includes(' as '))
      ? ['not followed: a method of an `impl Trait for`']
      : [],
  };
};
