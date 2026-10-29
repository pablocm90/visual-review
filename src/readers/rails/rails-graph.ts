import { join } from 'node:path';
import type { Node } from 'web-tree-sitter';
import type { Graph, GraphNode } from '../../core/graph.ts';
import type { SourceFile } from '../sources-in.ts';
import { parseRuby } from './ruby-syntax.ts';

type Place = {
  readonly layer: string;
  readonly folder: string;
  readonly names: ReadonlyArray<string>;
};

const placeOf = (file: string): Place => {
  const [top = '', layer = '', ...rest] = file.split('/');
  if (top === 'lib') return { layer: top, folder: top, names: [layer, ...rest] };
  const folder = join(top, layer);
  return { layer: layer === 'lib' ? folder : layer, folder, names: rest };
};

const camelized = (name: string): string =>
  name
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');

const constantOf = (names: ReadonlyArray<string>): string =>
  names.map(name => camelized(name.replace(/\.rb$/, ''))).join('::');

const DEFINITIONS = new Set(['class', 'module']);

const definitionsIn = (node: Node, scope: ReadonlyArray<string>): ReadonlyArray<string> =>
  node.namedChildren.flatMap(child => {
    const name = child.childForFieldName('name');
    if (!DEFINITIONS.has(child.type) || name === null) return [];
    const defined = [...scope, name.text];
    const body = child.childForFieldName('body');
    return [defined.join('::'), ...(body === null ? [] : definitionsIn(body, defined))];
  });

const definedConstant = (program: Node | undefined, names: ReadonlyArray<string>): string => {
  const defined = program === undefined ? [] : definitionsIn(program, []);
  const tails = names.map((_, start) => constantOf(names.slice(start)).toLowerCase());
  const [named] = tails.flatMap(tail =>
    defined.filter(constant => constant.toLowerCase() === tail),
  );
  return named ?? constantOf(names);
};

const isDefinedName = ({ parent, id }: Node): boolean =>
  parent?.childForFieldName('name')?.id === id;

const referencesIn = (program: Node | undefined): ReadonlyArray<string> => [
  ...new Set(
    (program?.descendantsOfType(['constant', 'scope_resolution']) ?? [])
      .filter(node => node.parent?.type !== 'scope_resolution' && !isDefinedName(node))
      .map(({ text }) => text),
  ),
];

type RailsGraphOptions = {
  readonly stack: string;
  readonly root: string;
  readonly files: ReadonlyArray<SourceFile>;
};

export const railsGraph = ({ stack, root, files }: RailsGraphOptions): Graph => {
  const classes = files
    .toSorted((a, b) => (a.file < b.file ? -1 : 1))
    .map(({ file, text }) => {
      const { layer, folder, names } = placeOf(file);
      const program = parseRuby(text);
      return { file, layer, folder, program, constant: definedConstant(program, names) };
    })
    .filter(
      ({ constant }, index, all) => all.findIndex(other => other.constant === constant) === index,
    );
  const nodes = new Map(
    classes
      .flatMap(({ file, layer, folder, constant }): ReadonlyArray<GraphNode> => {
        const box: GraphNode = {
          id: `${stack}/layer/${layer}`,
          kind: 'module',
          label: layer,
          parent: stack,
          path: join(root, folder),
        };
        return [
          box,
          {
            id: `${stack}/class/${constant}`,
            kind: 'file',
            label: constant,
            parent: box.id,
            path: join(root, file),
          },
        ];
      })
      .map(node => [node.id, node]),
  );
  const edges = classes.flatMap(({ constant, program }) =>
    referencesIn(program)
      .filter(written => written !== constant)
      .map(written => ({ from: `${stack}/class/${constant}`, to: `${stack}/class/${written}` })),
  );
  const stackNode: GraphNode = { id: stack, kind: 'stack', label: stack, path: '' };
  return { nodes: [stackNode, ...nodes.values()], edges };
};
