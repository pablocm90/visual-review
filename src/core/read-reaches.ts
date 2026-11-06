import type { GraphNode } from './graph.ts';
import type { MeasuredNode } from './metrics.ts';
import type { RangeReading, SymbolFile } from './read-range.ts';
import type { StacksReading } from './read-stacks.ts';
import type { Reader, SymbolUse, UsesReading } from './reader.ts';
import { qualified, type SymbolStatement } from './symbol-changes.ts';
import { anchoredSymbols, removalOf, unbackedExports, unheld } from './symbol-findings.ts';

export type ReachingUse = SymbolUse & { readonly test?: true };

export type Reach = {
  readonly node: string;
  readonly id: string;
  readonly label: string;
  readonly how: string;
  readonly uses: ReadonlyArray<ReachingUse>;
};

type Asked = {
  readonly id: string;
  readonly label: string;
  readonly how: string;
  readonly name: string;
};

type Readable = Exclude<SymbolFile, { readonly unreadable: string }>;

const askOf = (
  item: SymbolStatement,
  pathOf: (id: string) => string,
): Omit<Asked, 'id'> | undefined => {
  const removal = removalOf(item, pathOf);
  if (removal !== undefined)
    return { label: `${item.kind} ${removal.former}`, how: removal.how, name: removal.former };
  const name = qualified(item);
  return item.signature !== undefined && item.exported.base === true
    ? { label: `${item.kind} ${name}`, how: 'signature changed', name }
    : undefined;
};

const askedOf = (file: Readable, pathOf: (id: string) => string): ReadonlyArray<Asked> =>
  unheld(anchoredSymbols(file.node, file.symbols)).flatMap(({ item, id }) => {
    const ask = askOf(item, pathOf);
    return ask === undefined ? [] : [{ id, ...ask }];
  });

const unbackedAsked = (file: Readable): ReadonlyArray<Asked> =>
  unbackedExports(file).removed.map(name => ({
    id: `${file.node}#${name}`,
    label: `export ${name}`,
    how: 'removed',
    name,
  }));

const placeOf = ({ path, line }: SymbolUse): string => `${path}:${line}`;

type ReadReachesOptions = {
  readonly sides: { readonly before: string; readonly after: string };
  readonly before: StacksReading;
  readonly after: Pick<StacksReading, 'graph'>;
  readonly symbols: ReadonlyArray<SymbolFile>;
  readonly measured: ReadonlyArray<MeasuredNode>;
  readonly changedPaths: ReadonlyArray<string>;
  readonly pathOf: (id: string) => string;
};

type FileReaches = Pick<RangeReading, 'reaches' | 'reachesNotRead'>;

const NOTHING_READ: FileReaches = { reaches: [], reachesNotRead: [] };

type RowsOfOptions = {
  readonly reader: Reader;
  readonly uses: UsesReading['uses'];
  readonly changedPaths: ReadonlyArray<string>;
};

const rowsOfIn =
  ({ reader, uses, changedPaths }: RowsOfOptions) =>
  (name: string): ReadonlyArray<ReachingUse> => {
    const isTest = ({ path }: SymbolUse) => reader.isTestFile(path);
    return (uses[name] ?? [])
      .filter(({ path }) => !changedPaths.includes(path))
      .toSorted(
        (one, other) =>
          Number(isTest(one)) - Number(isTest(other)) || one.path.localeCompare(other.path),
      )
      .map(use => (isTest(use) ? { ...use, test: true as const } : use));
  };

type ReachesInOptions = {
  readonly node: string;
  readonly symbolsAsked: ReadonlyArray<Asked>;
  readonly exportsAsked: ReadonlyArray<Asked>;
  readonly rowsOf: (name: string) => ReadonlyArray<ReachingUse>;
};

const reachesIn = ({
  node,
  symbolsAsked,
  exportsAsked,
  rowsOf,
}: ReachesInOptions): ReadonlyArray<Reach> => {
  const reachOf = ({ name, ...reach }: Asked, rows: ReadonlyArray<ReachingUse>) =>
    rows.length === 0 ? [] : [{ node, ...reach, uses: rows }];
  const symbolReaches = symbolsAsked.flatMap(asked => reachOf(asked, rowsOf(asked.name)));
  const reached = new Set(symbolReaches.flatMap(({ uses }) => uses.map(placeOf)));
  return [
    ...symbolReaches,
    ...exportsAsked.flatMap(asked =>
      reachOf(
        asked,
        rowsOf(asked.name).filter(use => !reached.has(placeOf(use))),
      ),
    ),
  ];
};

type Asking = {
  readonly file: Readable;
  readonly reader: Reader;
  readonly ask: NonNullable<Reader['uses']>;
  readonly node: GraphNode;
};

const askReader = async (
  { sides, before, after, changedPaths, pathOf }: ReadReachesOptions,
  { file, reader, ask, node }: Asking,
): Promise<FileReaches> => {
  const symbolsAsked = askedOf(file, pathOf);
  const exportsAsked = unbackedAsked(file);
  if (symbolsAsked.length + exportsAsked.length === 0) return NOTHING_READ;
  const { uses, notRead, notFollowed } = await ask({
    base: sides.before,
    head: sides.after,
    stacks: new Map(
      before.stacks
        .filter(drawn => drawn.reader === reader)
        .map(({ root, stack }) => [root, stack]),
    ),
    graph: before.graph,
    graphAtHead: after.graph,
    node,
    names: [...symbolsAsked, ...exportsAsked].map(({ name }) => name),
  });
  return {
    reaches: reachesIn({
      node: file.node,
      symbolsAsked,
      exportsAsked,
      rowsOf: rowsOfIn({ reader, uses, changedPaths }),
    }),
    reachesNotRead: [
      ...notRead.filter(path => !changedPaths.includes(path)).map(path => `not read: ${path}`),
      ...notFollowed,
    ],
  };
};

const readFile = async (options: ReadReachesOptions, file: Readable): Promise<FileReaches> => {
  const { before, measured } = options;
  const drawn = before.stacks.find(({ stack }) => stack === file.stack);
  if (drawn !== undefined && drawn.reader.uses === undefined)
    return { reaches: [], reachesNotRead: [`not read for ${file.stack}`] };
  const basePath = measured.find(({ id }) => id === file.node)?.basePath;
  const node = before.graph.nodes.find(({ path }) => path === basePath);
  return drawn?.reader.uses === undefined || node === undefined
    ? NOTHING_READ
    : askReader(options, {
        file,
        reader: drawn.reader,
        ask: drawn.reader.uses,
        node,
      }).catch((error: unknown) => ({
        reaches: [],
        reachesNotRead: [`not read for ${file.stack}: ${String(error)}`],
      }));
};

export const readReaches = async (options: ReadReachesOptions): Promise<FileReaches> => {
  const read = await Promise.all(
    options.symbols.map(file => ('unreadable' in file ? NOTHING_READ : readFile(options, file))),
  );
  return {
    reaches: read.flatMap(({ reaches }) => reaches),
    reachesNotRead: [...new Set(read.flatMap(({ reachesNotRead }) => reachesNotRead))],
  };
};
