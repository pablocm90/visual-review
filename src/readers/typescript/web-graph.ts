import { join, matchesGlob } from 'node:path';
import { z } from 'zod';
import type { Graph, GraphNode } from '../../graph.ts';

const CruiseOutputSchema = z.object({
  modules: z.array(
    z.object({
      source: z.string(),
      coreModule: z.boolean().optional(),
      couldNotResolve: z.boolean().optional(),
      dependencies: z.array(z.object({ module: z.string(), resolved: z.string() })),
    }),
  ),
});

type SourceOptions = {
  readonly stack: string;
  readonly sourceRoot: string;
  readonly source: string;
};

const prefixOf = (sourceRoot: string): string => (sourceRoot === '.' ? '' : `${sourceRoot}/`);

const relativeTo = (sourceRoot: string, source: string): string =>
  source.slice(prefixOf(sourceRoot).length);

export const fileId = ({ stack, sourceRoot, source }: SourceOptions): string =>
  `${stack}/file/${relativeTo(sourceRoot, source)}`;

type StackOptions = {
  readonly stack: string;
  readonly directory: string;
  readonly sourceRoot: string;
  readonly boxes: ReadonlyArray<string>;
};

const nodesOf = ({
  stack,
  directory,
  sourceRoot,
  boxes,
  source,
}: StackOptions & SourceOptions): ReadonlyArray<GraphNode> => {
  const relative = relativeTo(sourceRoot, source);
  const parts = relative.split('/');
  const file = {
    id: fileId({ stack, sourceRoot, source }),
    kind: 'file',
    path: join(directory, source),
  } as const;
  if (parts.length === 1) return [{ ...file, label: relative, parent: stack }];
  const folders = parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'));
  const [first = relative] = folders;
  const label = folders.findLast(folder => boxes.some(box => matchesGlob(folder, box))) ?? first;
  const module: GraphNode = {
    id: `${stack}/module/${label}`,
    kind: 'module',
    label,
    parent: stack,
    path: join(directory, sourceRoot, label),
  };
  return [module, { ...file, label: relative.slice(label.length + 1), parent: module.id }];
};

const packageOf = (module: string): string =>
  module
    .split('/')
    .slice(0, module.startsWith('@') ? 2 : 1)
    .join('/');

type WebGraphOptions = StackOptions & {
  readonly cruiseJson: string;
  readonly packages: ReadonlyMap<string, string>;
};

export const webGraph = ({
  stack,
  directory,
  sourceRoot,
  boxes,
  cruiseJson,
  packages,
}: WebGraphOptions): Graph => {
  const { modules } = CruiseOutputSchema.parse(JSON.parse(cruiseJson));
  const sources = modules.filter(
    ({ source, coreModule, couldNotResolve }) =>
      source.startsWith(prefixOf(sourceRoot)) && !coreModule && !couldNotResolve,
  );
  const sourcePaths = new Set(sources.map(({ source }) => source));
  const nodes = new Map(
    sources
      .flatMap(({ source }) => nodesOf({ stack, directory, sourceRoot, boxes, source }))
      .map(node => [node.id, node]),
  );
  const targetsOf = (dependency: { readonly module: string; readonly resolved: string }) => {
    if (sourcePaths.has(dependency.resolved))
      return [fileId({ stack, sourceRoot, source: dependency.resolved })];
    const sibling = packages.get(packageOf(dependency.module));
    return sibling === undefined || sibling === stack ? [] : [sibling];
  };
  const edges = sources.flatMap(module => {
    const from = fileId({ stack, sourceRoot, source: module.source });
    return [...new Set(module.dependencies.flatMap(targetsOf))].map(to => ({ from, to }));
  });
  const stackNode: GraphNode = { id: stack, kind: 'stack', label: stack, path: '' };
  return { nodes: [stackNode, ...nodes.values()], edges };
};
