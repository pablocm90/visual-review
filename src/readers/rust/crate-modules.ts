import { basename, dirname, join } from 'node:path';
import type { Node } from 'web-tree-sitter';
import { edgeId, type Graph, type GraphEdge, type GraphNode } from '../../core/graph.ts';
import { crateId } from './crate-graph.ts';
import { isCfgTest, itemsIn, parseRust } from './rust-syntax.ts';

type CrateModulesOptions = {
  readonly stack: string;
  readonly root: string;
  readonly crate: string;
  readonly roots: ReadonlyArray<string>;
  readonly sources: Readonly<Record<string, string>>;
};

type Segments = ReadonlyArray<string>;

type Module = {
  readonly label: string;
  readonly path: string;
  readonly segments: Segments;
  readonly items: ReadonlyArray<Node>;
};

const itemsOf = (text: string): ReadonlyArray<Node> => {
  const root = parseRust(text);
  if (root === undefined) return [];
  return itemsIn(root)
    .filter(({ attributes }) => !attributes.some(isCfgTest))
    .map(({ node }) => node);
};

const declaredModules = (items: ReadonlyArray<Node>): Segments =>
  items.flatMap(node =>
    node.type === 'mod_item' && node.childForFieldName('body') === null
      ? [node.childForFieldName('name')?.text ?? '']
      : [],
  );

const EXTERN_PRELUDE = '::';

const segmentsOf = (node: Node | null): Segments => {
  if (node === null) return [EXTERN_PRELUDE];
  if (node.type !== 'scoped_identifier') return [node.text];
  return [
    ...segmentsOf(node.childForFieldName('path')),
    node.childForFieldName('name')?.text ?? '',
  ];
};

const pathsInUse = (node: Node): ReadonlyArray<Segments> => {
  if (node.type === 'use_list') return node.namedChildren.flatMap(pathsInUse);
  if (node.type === 'use_as_clause') return [segmentsOf(node.childForFieldName('path'))];
  if (node.type === 'use_wildcard') return [segmentsOf(node.namedChildren[0] ?? null)];
  if (node.type === 'scoped_use_list') {
    const prefix = segmentsOf(node.childForFieldName('path'));
    const list = node.childForFieldName('list');
    return (list === null ? [] : pathsInUse(list)).map(path => [...prefix, ...path]);
  }
  return [segmentsOf(node)];
};

const usedPaths = (items: ReadonlyArray<Node>): ReadonlyArray<Segments> =>
  items.flatMap(node => {
    const argument = node.type === 'use_declaration' ? node.childForFieldName('argument') : null;
    return argument === null ? [] : pathsInUse(argument);
  });

type ReadModuleOptions = {
  readonly path: string;
  readonly segments: Segments;
  readonly label: string;
};

type WithChildrenOptions = {
  readonly module: Module;
  readonly directory: string;
};

export const crateModules = ({
  stack,
  root,
  crate,
  roots,
  sources,
}: CrateModulesOptions): Graph => {
  const readModule = ({ path, segments, label }: ReadModuleOptions): Module => ({
    label,
    path,
    segments,
    items: itemsOf(sources[path] ?? ''),
  });
  const withChildren = ({ module, directory }: WithChildrenOptions): ReadonlyArray<Module> => [
    module,
    ...declaredModules(module.items).flatMap(name => {
      const found = [join(directory, `${name}.rs`), join(directory, name, 'mod.rs')].find(
        candidate => sources[candidate] !== undefined,
      );
      if (found === undefined) return [];
      const segments = [...module.segments, name];
      return withChildren({
        module: readModule({ path: found, segments, label: segments.join('::') }),
        directory: join(directory, name),
      });
    }),
  ];
  const idOf = (module: Module): string => `${stack}/mod/${crate}/${module.label}`;
  const trees = roots.map(path =>
    withChildren({
      module: readModule({ path, segments: [], label: basename(path) }),
      directory: dirname(path),
    }),
  );
  const edges = trees.flatMap(tree => {
    const byKey = new Map(tree.map(module => [module.segments.join('::'), module]));
    const moduleAt = (segments: Segments) => byKey.get(segments.join('::'));
    const startOf = (from: Segments, first: string): Segments => {
      if (first === 'crate') return [];
      if (first === 'self') return from;
      if (first === 'super') return from.slice(0, -1);
      return [...from, first];
    };
    const targetOf = (from: Segments, [first = '', ...rest]: Segments): Module | undefined => {
      const absolute = rest.reduce<Segments>(
        (at, segment) => (segment === 'super' ? at.slice(0, -1) : at.concat(segment)),
        startOf(from, first),
      );
      return Array.from({ length: absolute.length + 1 }, (_, index) =>
        moduleAt(absolute.slice(0, absolute.length - index)),
      ).find(module => module !== undefined);
    };
    return tree.flatMap(module =>
      usedPaths(module.items).flatMap((path): ReadonlyArray<GraphEdge> => {
        const target = targetOf(module.segments, path);
        return target === undefined || target === module
          ? []
          : [{ from: idOf(module), to: idOf(target) }];
      }),
    );
  });
  return {
    nodes: trees.flat().map(
      (module): GraphNode => ({
        id: idOf(module),
        kind: 'file',
        label: module.label,
        parent: crateId(stack, crate),
        path: join(root, module.path),
      }),
    ),
    edges: [...new Map(edges.map(edge => [edgeId(edge), edge])).values()],
  };
};
