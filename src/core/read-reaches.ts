import type { MeasuredNode } from './metrics.ts';
import type { RangeReading, SymbolFile } from './read-range.ts';
import type { StacksReading } from './read-stacks.ts';
import type { SymbolUse } from './reader.ts';
import type { SymbolStatement } from './symbol-changes.ts';
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
  return item.signature !== undefined && item.exported.base === true
    ? { label: `${item.kind} ${item.name}`, how: 'signature changed', name: item.name }
    : undefined;
};

const askedOf = (file: Readable, pathOf: (id: string) => string): ReadonlyArray<Asked> =>
  anchoredSymbols(file.node, file.symbols)
    .filter(({ item }) => item.scope === undefined)
    .flatMap(({ item, id }) => {
      const ask = askOf(item, pathOf);
      return ask === undefined ? [] : [{ id, ...ask }];
    });

const methodsAskedIn = (file: Readable, pathOf: (id: string) => string): boolean =>
  unheld(anchoredSymbols(file.node, file.symbols)).some(
    ({ item }) => item.scope !== undefined && askOf(item, pathOf) !== undefined,
  );

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
  readonly symbols: ReadonlyArray<SymbolFile>;
  readonly measured: ReadonlyArray<MeasuredNode>;
  readonly changedPaths: ReadonlyArray<string>;
  readonly pathOf: (id: string) => string;
};

type FileReaches = Pick<RangeReading, 'reaches' | 'reachesNotRead'>;

const NOTHING_READ: FileReaches = { reaches: [], reachesNotRead: [] };

export const readReaches = async ({
  sides,
  before,
  symbols,
  measured,
  changedPaths,
  pathOf,
}: ReadReachesOptions): Promise<FileReaches> => {
  const changed = new Set(changedPaths);
  const read = await Promise.all(
    symbols.map(async (file): Promise<FileReaches> => {
      if ('unreadable' in file) return NOTHING_READ;
      const reader = before.stacks.find(({ stack }) => stack === file.stack)?.reader;
      if (reader !== undefined && reader.uses === undefined)
        return { reaches: [], reachesNotRead: [`not read for ${file.stack}`] };
      const basePath = measured.find(({ id }) => id === file.node)?.basePath;
      const node = before.graph.nodes.find(({ path }) => path === basePath);
      const symbolsAsked = askedOf(file, pathOf);
      const exportsAsked = unbackedAsked(file);
      const methods = methodsAskedIn(file, pathOf) ? ['methods not followed'] : [];
      if (reader?.uses === undefined || node === undefined) return NOTHING_READ;
      if (symbolsAsked.length + exportsAsked.length === 0)
        return { reaches: [], reachesNotRead: methods };
      const { uses, notRead } = await reader.uses({
        base: sides.before,
        head: sides.after,
        graph: before.graph,
        node,
        names: [...symbolsAsked, ...exportsAsked].map(({ name }) => name),
      });
      const isTest = ({ path }: SymbolUse) => reader.isTestFile(path);
      const rowsOf = (name: string): ReadonlyArray<ReachingUse> =>
        (uses[name] ?? [])
          .filter(({ path }) => !changed.has(path))
          .toSorted(
            (one, other) =>
              Number(isTest(one)) - Number(isTest(other)) || one.path.localeCompare(other.path),
          )
          .map(use => (isTest(use) ? { ...use, test: true as const } : use));
      const reachOf = ({ name, ...reach }: Asked, rows: ReadonlyArray<ReachingUse>) =>
        rows.length === 0 ? [] : [{ node: file.node, ...reach, uses: rows }];
      const symbolReaches = symbolsAsked.flatMap(asked => reachOf(asked, rowsOf(asked.name)));
      const reached = new Set(symbolReaches.flatMap(({ uses }) => uses.map(placeOf)));
      return {
        reaches: [
          ...symbolReaches,
          ...exportsAsked.flatMap(asked =>
            reachOf(
              asked,
              rowsOf(asked.name).filter(use => !reached.has(placeOf(use))),
            ),
          ),
        ],
        reachesNotRead: [
          ...methods,
          ...(before.roots.filter(root => root.reader === reader).length > 1
            ? ['other stacks not followed']
            : []),
          ...notRead.filter(path => !changed.has(path)).map(path => `not read: ${path}`),
        ],
      };
    }),
  );
  return {
    reaches: read.flatMap(({ reaches }) => reaches),
    reachesNotRead: [...new Set(read.flatMap(({ reachesNotRead }) => reachesNotRead))],
  };
};
