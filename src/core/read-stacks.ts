import { type Config, stackSettings } from './config.ts';
import { type Graph, stackOfIn } from './graph.ts';
import type { DanglingCall, Linker } from './linker.ts';
import type { Reader } from './reader.ts';
import type { Skipped } from './skipped.ts';

export type Adapters = {
  readonly readers: ReadonlyArray<Reader>;
  readonly linkers: ReadonlyArray<Linker>;
  readonly onPath: (command: string) => boolean;
};

export type ReaderRoot = {
  readonly reader: Reader;
  readonly root: string;
};

type DrawnStack = ReaderRoot & {
  readonly stack: string;
  readonly graph: (root: string) => Promise<Graph>;
};

export type StacksReading = {
  readonly graph: Graph;
  readonly danglingCalls: ReadonlyArray<DanglingCall>;
  readonly roots: ReadonlyArray<ReaderRoot>;
  readonly stacks: ReadonlyArray<ReaderRoot & { readonly stack: string }>;
  readonly skipped: ReadonlyArray<Skipped>;
};

type ReadStacksOptions = Adapters & {
  readonly directory: string;
  readonly repoName: string;
  readonly config: Config;
};

const missingToolOf = ({ tool }: Reader, onPath: Adapters['onPath']): string | undefined =>
  tool === undefined || onPath(tool) ? undefined : tool;

const drawnIn = ({
  directory,
  repoName,
  config,
  readers,
}: ReadStacksOptions): ReadonlyArray<DrawnStack> =>
  readers.reduce<{
    readonly taken: ReadonlySet<string>;
    readonly drawn: ReadonlyArray<DrawnStack>;
  }>(
    (sofar, reader) => {
      const { stacks, graph } = reader.open({ directory, repoName, config, taken: sofar.taken });
      return {
        taken: new Set([...sofar.taken, ...stacks.values()]),
        drawn: [
          ...sofar.drawn,
          ...[...stacks].map(([root, stack]) => ({ reader, root, stack, graph })),
        ],
      };
    },
    { taken: new Set(), drawn: [] },
  ).drawn;

export const readStacks = async (options: ReadStacksOptions): Promise<StacksReading> => {
  const { directory, config, readers, linkers, onPath } = options;
  const stacks = drawnIn(options);
  const kept = stacks.filter(({ stack }) => config.stacks[stack] !== false);
  const skipped = readers.flatMap(reader => {
    const tool = missingToolOf(reader, onPath);
    const ids = kept.filter(drawn => drawn.reader === reader).map(({ stack }) => stack);
    return tool === undefined || ids.length === 0
      ? []
      : [{ reader: reader.name, tool, stacks: ids }];
  });
  const graphs = await Promise.all(
    kept
      .filter(({ reader }) => !skipped.some(({ reader: name }) => name === reader.name))
      .map(({ root, graph }) => graph(root)),
  );
  const nodes = graphs
    .flatMap(graph => graph.nodes)
    .map(node => ({ ...node, label: stackSettings(config, node.id).label ?? node.label }));
  const stackOf = stackOfIn(nodes);
  const linkedBy = (reader: Reader['name'], only: ReadonlyArray<string> | undefined) =>
    kept
      .filter(drawn => drawn.reader.name === reader && (only?.includes(drawn.stack) ?? true))
      .map(({ stack }) => ({ stack, nodes: nodes.filter(({ id }) => stackOf(id) === stack) }));
  const links = await Promise.all(
    linkers.flatMap(linker => {
      const settings = config.linkers[linker.name] ?? {};
      if (settings === false) return [];
      return [
        linker.link({
          directory,
          from: linkedBy(linker.from, settings.from),
          to: linkedBy(linker.to, settings.to),
        }),
      ];
    }),
  );
  const ids = new Set(nodes.map(({ id }) => id));
  const edges = [...graphs.flatMap(graph => graph.edges), ...links.flatMap(({ edges }) => edges)];
  return {
    graph: { nodes, edges: edges.filter(edge => ids.has(edge.from) && ids.has(edge.to)) },
    danglingCalls: links.flatMap(({ dangling }) => dangling),
    roots: kept,
    stacks,
    skipped,
  };
};
