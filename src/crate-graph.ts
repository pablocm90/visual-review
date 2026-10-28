import { dirname, relative } from 'node:path';
import { z } from 'zod';
import type { Graph, GraphNode } from './graph.ts';

const CargoMetadataSchema = z.object({
  workspace_root: z.string(),
  packages: z.array(
    z.object({
      name: z.string(),
      manifest_path: z.string(),
      dependencies: z.array(z.object({ path: z.string().optional() })),
      targets: z.array(z.object({ kind: z.array(z.string()), src_path: z.string() })),
    }),
  ),
});

const rustStack = { id: 'rust', kind: 'stack', label: 'rust', path: '' } as const;

export const crateId = (name: string): string => `${rustStack.id}/crate/${name}`;

export const crateGraph = (metadataJson: string): Graph => {
  const metadata = CargoMetadataSchema.parse(JSON.parse(metadataJson));
  const crates = metadata.packages.map(pkg => ({
    ...pkg,
    directory: dirname(pkg.manifest_path),
  }));
  const idByDirectory = new Map<string | undefined, string>(
    crates.map(pkg => [pkg.directory, crateId(pkg.name)]),
  );
  return {
    nodes: [
      rustStack,
      ...crates.map(
        (pkg): GraphNode => ({
          id: crateId(pkg.name),
          kind: 'package',
          label: pkg.name,
          parent: rustStack.id,
          path: relative(metadata.workspace_root, pkg.directory),
        }),
      ),
    ],
    edges: crates.flatMap(pkg => {
      const targets = new Set(
        pkg.dependencies.flatMap(dependency => {
          const to = idByDirectory.get(dependency.path);
          return to === undefined ? [] : [to];
        }),
      );
      return [...targets].map(to => ({ from: crateId(pkg.name), to }));
    }),
  };
};

const NOT_A_ROOT = new Set(['test', 'bench', 'example', 'custom-build']);

export const crateRoots = (metadataJson: string) => {
  const metadata = CargoMetadataSchema.parse(JSON.parse(metadataJson));
  return metadata.packages.map(pkg => ({
    crate: pkg.name,
    directory: relative(metadata.workspace_root, dirname(pkg.manifest_path)),
    roots: pkg.targets
      .filter(target => !target.kind.some(kind => NOT_A_ROOT.has(kind)))
      .map(target => relative(metadata.workspace_root, target.src_path)),
  }));
};
