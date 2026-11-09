import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Node } from 'web-tree-sitter';
import type { GraphNode } from '../../core/graph.ts';
import type { SymbolUse, UsesAsked, UsesReading } from '../../core/reader.ts';
import { isNoFile } from '../no-file.ts';
import { isTooBig } from '../too-big.ts';
import { isTestCode, readRust, TEST_FOLDER } from './rust-syntax.ts';
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

const NOT_READ = 'not read';

const UNSEEN =
  'not followed: a module of its own crate with no `use` into its file, a crate named otherwise than by its package, such as through `[lib] name` or a renamed dependency, a binary naming its own package’s library, a name re-exported through `pub use`, and a path inside a macro';

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

type Scope = {
  readonly paths: ReadonlyArray<Node>;
  readonly fields: ReadonlyArray<Node>;
  readonly importedFormsOf: (item: Segments) => ReadonlySet<string>;
  readonly writtenFormsOf: (item: Segments) => ReadonlySet<string>;
};

const formsIn =
  (imports: ReadonlyArray<Imported>) =>
  (item: Segments): ReadonlySet<string> =>
    new Set(
      imports
        .filter(({ segments }) => isPrefix(segments, item))
        .map(({ segments, local }) => [...local, ...item.slice(segments.length)].join('::')),
    );

const scopeOf = (root: Node, from: Segments, target: Segments): Scope => {
  const imported = importsIn(root, from, target[0] ?? '');
  return {
    paths: root
      .descendantsOfType(['identifier', 'type_identifier', ...PATHS])
      .filter(node => !isInUse(node) && !namesItsParent(node)),
    fields: root
      .descendantsOfType('field_identifier')
      .filter(node => node.parent?.type === 'field_expression'),
    importedFormsOf: formsIn(imported),
    writtenFormsOf: formsIn([
      ...imported,
      importedOf(target.slice(0, 1)),
      importedOf(from.slice(0, 1), ['crate']),
      importedOf(from, ['self']),
      importedOf(from.slice(0, -1), ['super']),
    ]),
  };
};

const firstUseIn = (
  { paths, fields, importedFormsOf, writtenFormsOf }: Scope,
  item: Segments,
  isMethod: boolean,
): Node | undefined => {
  const forms = writtenFormsOf(item);
  const calls =
    isMethod && importedFormsOf(item.slice(0, -1)).size > 0
      ? fields.filter(node => node.text === item.at(-1))
      : [];
  return [...paths.filter(node => forms.has(segmentsOf(node).join('::'))), ...calls].toSorted(
    (one, other) => one.startIndex - other.startIndex,
  )[0];
};

const rowsIn = (
  { path, text, from }: Candidate,
  target: Segments,
  names: ReadonlyArray<string>,
): ReadonlyMap<string, ReadonlyArray<SymbolUse>> | typeof NOT_READ => {
  if (isTooBig(text)) return NOT_READ;
  return readRust(text, root => {
    if (root.hasError) return NOT_READ;
    const scope = scopeOf(root, from, target);
    const lines = text.split('\n');
    return new Map(
      names.map(name => {
        const first = firstUseIn(scope, [...target, ...name.split(/::|\./)], name.includes('.'));
        if (first === undefined) return [name, []];
        const row = first.startPosition.row;
        const line = (lines[row] ?? '').trim();
        const test = TEST_FOLDER.test(path) || isTestCode(first);
        return [name, [{ path, line: row + 1, text: line, test }]];
      }),
    );
  });
};

const textAt = (file: string): string | undefined => {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    if (isNoFile(error)) return undefined;
    throw error;
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
  ].flatMap(module => {
    const text = textAt(join(head, module.path));
    return text === undefined
      ? []
      : [
          {
            path: module.path,
            rows: rowsIn(
              { path: module.path, text, from: segmentsOfModule(module) },
              target,
              names,
            ),
          },
        ];
  });
  return {
    uses: Object.fromEntries(
      names.map(name => [
        name,
        files.flatMap(({ rows }) => (rows === NOT_READ ? [] : (rows.get(name) ?? []))),
      ]),
    ),
    notRead: files.flatMap(({ path, rows }) => (rows === NOT_READ ? [path] : [])),
    notFollowed: [
      UNSEEN,
      ...(names.some(name => name.includes('.'))
        ? ['not followed: a method called on a value in a file not importing its type']
        : []),
      ...(names.some(name => name.includes(' as '))
        ? ['not followed: a method of an `impl Trait for`']
        : []),
    ],
  };
};
