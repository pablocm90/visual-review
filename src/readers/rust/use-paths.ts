import type { Node } from 'web-tree-sitter';

export type Segments = ReadonlyArray<string>;

export const EXTERN_PRELUDE = '::';

export const PATHS: ReadonlySet<string> = new Set(['scoped_identifier', 'scoped_type_identifier']);

export const segmentsOf = (node: Node | null): Segments => {
  if (node === null) return [EXTERN_PRELUDE];
  if (!PATHS.has(node.type)) return [node.text];
  return [
    ...segmentsOf(node.childForFieldName('path')),
    node.childForFieldName('name')?.text ?? '',
  ];
};

export type Imported = { readonly segments: Segments; readonly local: Segments };

export const importedOf = (segments: Segments, local: Segments = segments.slice(-1)): Imported => ({
  segments,
  local,
});

export const importsInUse = (node: Node): ReadonlyArray<Imported> => {
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

export const followed = (start: Segments, rest: Segments): Segments =>
  rest.reduce<Segments>(
    (at, segment) => (segment === 'super' ? at.slice(0, -1) : at.concat(segment)),
    start,
  );
