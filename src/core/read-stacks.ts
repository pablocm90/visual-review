import { CONFIG_FILE, type Config, folderOf, stackSettings } from './config.ts';
import { type Graph, stackOfIn } from './graph.ts';
import type { DanglingCall, Linker, Links } from './linker.ts';
import type { Reader } from './reader.ts';
import type { Skipped } from './skipped.ts';

export type Adapters = {
  readonly readers: ReadonlyArray<Reader>;
  readonly linkers: ReadonlyArray<Linker>;
  readonly onPath: (command: string) => boolean;
};

type ReaderRoot = {
  readonly reader: Reader;
  readonly root: string;
};

export type DrawnStack = ReaderRoot & {
  readonly stack: string;
};

export type StacksReading = {
  readonly graph: Graph;
  readonly danglingCalls: ReadonlyArray<DanglingCall>;
  readonly linksNotRead: ReadonlyArray<string>;
  readonly roots: ReadonlyArray<DrawnStack>;
  readonly stacks: ReadonlyArray<DrawnStack>;
  readonly skipped: ReadonlyArray<Skipped>;
};

type ReadStacksOptions = Adapters & {
  readonly directory: string;
  readonly repoName: string;
  readonly config: Config;
};

type AddedStack = {
  readonly stack: string;
  readonly root: string;
};

type AddedStacksOptions = {
  readonly config: Config;
  readonly reader: Reader['name'];
  readonly detected: ReadonlyMap<string, string>;
  readonly taken: ReadonlySet<string>;
};

const addedStacks = ({
  config,
  reader,
  detected,
  taken,
}: AddedStacksOptions): ReadonlyArray<AddedStack> => {
  const added = Object.entries(config.stacks).flatMap(([stack, settings]) =>
    settings && settings.reader === reader && settings.root !== undefined
      ? [{ stack, root: settings.root }]
      : [],
  );
  const problems = added.flatMap(({ stack, root }) => {
    const other = detected.get(folderOf(root));
    const detectedAt = [...detected].find(([, id]) => id === stack)?.[0];
    return [
      ...(other === undefined
        ? []
        : [
            `${CONFIG_FILE}: stacks.${stack}.root: ${root} is detected as stack ${other}; set stacks.${other} instead`,
          ]),
      ...(detectedAt === undefined
        ? []
        : [
            `${CONFIG_FILE}: stacks.${stack} is detected at ${detectedAt}; add the stack under another key, or drop its reader and root`,
          ]),
      ...(taken.has(stack)
        ? [
            `${CONFIG_FILE}: stacks.${stack} is drawn by another reader; add the stack under another key, or drop its reader and root`,
          ]
        : []),
    ];
  });
  if (problems.length > 0) throw new Error(problems.join('\n'));
  return added;
};

const OWN_FIELDS: ReadonlyArray<string> = ['reader', 'root', 'label'];

const undetectedIn = (config: Config, stacks: ReadonlyArray<DrawnStack>) =>
  Object.keys(config.stacks)
    .filter(stack => !stacks.some(drawn => drawn.stack === stack))
    .map(stack => {
      const { reader, root } = stackSettings(config, stack);
      return reader === undefined
        ? `${CONFIG_FILE}: stacks.${stack} names no detected stack; give it reader and root to add one`
        : `${CONFIG_FILE}: stacks.${stack}.root: ${root} holds no ${reader} stack on either side`;
    });

const untakenIn = (config: Config, stacks: ReadonlyArray<DrawnStack>) => [
  ...new Set(
    stacks.flatMap(({ stack, reader }) =>
      Object.keys(stackSettings(config, stack))
        .filter(field => !OWN_FIELDS.includes(field) && !reader.stackFields.includes(field))
        .map(
          field =>
            `${CONFIG_FILE}: stacks.${stack}.${field} is not taken by the ${reader.name} reader`,
        ),
    ),
  ),
];

const unlinkableIn = (
  config: Config,
  stacks: ReadonlyArray<DrawnStack>,
  linkers: ReadonlyArray<Linker>,
) =>
  linkers.flatMap(linker => {
    const settings = config.linkers[linker.name] || {};
    return (['from', 'to'] as const).flatMap(end =>
      (settings[end] ?? []).flatMap(stack => {
        if (config.stacks[stack] === false)
          return [
            `${CONFIG_FILE}: linkers.${linker.name}.${end}: ${stack} is dropped by stacks.${stack}`,
          ];
        return stacks.some(drawn => drawn.stack === stack && drawn.reader.name === linker[end])
          ? []
          : [
              `${CONFIG_FILE}: linkers.${linker.name}.${end}: ${stack} names no ${linker[end]} stack on either side`,
            ];
      }),
    );
  });

export const checkConfig = (
  config: Config,
  stacks: ReadonlyArray<DrawnStack>,
  linkers: ReadonlyArray<Linker>,
): void => {
  const problems = [
    ...undetectedIn(config, stacks),
    ...untakenIn(config, stacks),
    ...unlinkableIn(config, stacks, linkers),
  ];
  if (problems.length > 0) throw new Error(problems.join('\n'));
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

const linksOf = ({
  options: { directory, config, linkers },
  stacks,
  nodes,
  skipped,
}: {
  readonly options: ReadStacksOptions;
  readonly stacks: ReadonlyArray<DrawnStack>;
  readonly nodes: Graph['nodes'];
  readonly skipped: ReadonlyArray<Skipped>;
}): Promise<ReadonlyArray<Links>> => {
  const stackOf = stackOfIn(nodes);
  const atEnd = (reader: Reader['name'], only: ReadonlyArray<string> | undefined) =>
    stacks
      .filter(drawn => drawn.reader.name === reader && (only?.includes(drawn.stack) ?? true))
      .map(({ stack }) => stack);
  const linked = (ends: ReadonlyArray<string>) =>
    ends
      .filter(stack => config.stacks[stack] !== false)
      .map(stack => ({ stack, nodes: nodes.filter(({ id }) => stackOf(id) === stack) }));
  const skippedStacks = skipped.flatMap(({ stacks: names }) => names);
  return Promise.all(
    linkers.map(async (linker): Promise<Links> => {
      const settings = config.linkers[linker.name] ?? {};
      if (settings === false) return { edges: [], dangling: [], notRead: 'turned off' };
      const fromEnd = atEnd(linker.from, settings.from);
      const toEnd = atEnd(linker.to, settings.to);
      const read = await linker.link({ directory, from: linked(fromEnd), to: linked(toEnd) });
      const empty = [...fromEnd, ...toEnd].filter(
        stack => skippedStacks.includes(stack) || config.stacks[stack] === false,
      );
      return empty.length === 0 ? read : { ...read, notRead: `not read for ${empty.join(', ')}` };
    }),
  );
};

export const readStacks = async (options: ReadStacksOptions): Promise<StacksReading> => {
  const { directory, config, readers, onPath } = options;
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
  const links = await linksOf({ options, stacks, nodes, skipped });
  const ids = new Set(nodes.map(({ id }) => id));
  const edges = [...graphs.flatMap(graph => graph.edges), ...links.flatMap(({ edges }) => edges)];
  return {
    graph: { nodes, edges: edges.filter(edge => ids.has(edge.from) && ids.has(edge.to)) },
    danglingCalls: links.flatMap(({ dangling }) => dangling),
    linksNotRead: links.flatMap(({ notRead }) => (notRead === undefined ? [] : [notRead])),
    roots: kept,
    stacks,
    skipped,
  };
};
