import { join } from 'node:path';
import type { Graph, GraphNode } from './graph.ts';

type Place = {
  readonly layer: string;
  readonly folder: string;
  readonly names: ReadonlyArray<string>;
};

const placeOf = (file: string): Place => {
  const [top = '', layer = '', ...rest] = file.split('/');
  if (top === 'lib') return { layer: top, folder: top, names: [layer, ...rest] };
  const names = rest[0] === 'concerns' ? rest.slice(1) : rest;
  return { layer, folder: join(top, layer), names };
};

const camelized = (name: string): string =>
  name
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');

const constantOf = (names: ReadonlyArray<string>): string =>
  names.map(name => camelized(name.replace(/\.rb$/, ''))).join('::');

type RailsGraphOptions = {
  readonly stack: string;
  readonly files: ReadonlyArray<string>;
};

export const railsGraph = ({ stack, files }: RailsGraphOptions): Graph => {
  const nodes = new Map(
    files
      .toSorted()
      .flatMap((file): ReadonlyArray<GraphNode> => {
        const { layer, folder, names } = placeOf(file);
        const box: GraphNode = {
          id: `${stack}/layer/${layer}`,
          kind: 'module',
          label: layer,
          parent: stack,
          path: folder,
        };
        const constant = constantOf(names);
        return [
          box,
          {
            id: `${stack}/class/${constant}`,
            kind: 'file',
            label: constant,
            parent: box.id,
            path: file,
          },
        ];
      })
      .map(node => [node.id, node]),
  );
  const stackNode: GraphNode = { id: stack, kind: 'stack', label: stack, path: '' };
  return { nodes: [stackNode, ...nodes.values()], edges: [] };
};
