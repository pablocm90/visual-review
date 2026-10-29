import { addedStacks, type Config, stackSettings } from './config.ts';
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
};

export type StacksReading = {
  readonly graph: Graph;
  readonly danglingCalls: ReadonlyArray<DanglingCall>;
  readonly roots: ReadonlyArray<ReaderRoot>;
  readonly stacks: ReadonlyArray<DrawnStack>;
  readonly skipped: ReadonlyArray<Skipped>;
};

type ReadStacksOptions = Adapters & {
  readonly directory: string;
  readonly repoName: string;
  readonly config: Config;
};

const missingToolOf = ({ tool }: Reader, onPath: Adapters['onPath']): string | undefined =>
  tool === undefined || onPath(tool) ? undefined : tool;

const freeId = (name: string, used: ReadonlySet<string>): string => {
  const suffixed = (n: number): string =>
    used.has(`${name}~${n}`) ? suffixed(n + 1) : `${name}~${n}`;
  return used.has(name) ? suffixed(2) : name;
};

const drawnIn = ({
  directory,
  repoName,
  config,
  readers,
}: ReadStacksOptions): ReadonlyArray<DrawnStack> =>
  readers.reduce<ReadonlyArray<DrawnStack>>((drawn, reader) => {
    const holds = (root: string, stack: string): boolean =>
      reader.holds({ directory, root, settings: stackSettings(config, stack) });
    const detected = reader
      .roots(directory)
      .reduce<ReadonlyArray<DrawnStack>>((found, { root, name }) => {
        const used = new Set([...drawn, ...found].map(({ stack }) => stack));
        const stack = freeId(name ?? (root === '.' ? repoName : root), used);
        return holds(root, stack) ? [...found, { reader, root, stack }] : found;
      }, []);
    const added = addedStacks({
      config,
      reader: reader.name,
      detected: new Map(detected.map(({ root, stack }) => [root, stack])),
      taken: new Set(drawn.map(({ stack }) => stack)),
    })
      .filter(({ root, stack }) => holds(root, stack))
      .map(({ root, stack }) => ({ reader, root, stack }));
    return [...drawn, ...detected, ...added];
  }, []);

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
      .map(({ reader, root, stack }) =>
        reader.graph({
          directory,
          root,
          stack,
          settings: stackSettings(config, stack),
          stacks: new Map(
            stacks.filter(drawn => drawn.reader === reader).map(drawn => [drawn.root, drawn.stack]),
          ),
        }),
      ),
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
