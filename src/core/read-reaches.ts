import type { MeasuredNode } from './metrics.ts';
import type { SymbolFile } from './read-range.ts';
import type { StacksReading } from './read-stacks.ts';
import type { SymbolUse } from './reader.ts';
import { anchoredSymbols, removalOf } from './symbol-findings.ts';

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

const askedOf = (
  file: Exclude<SymbolFile, { readonly unreadable: string }>,
  pathOf: (id: string) => string,
): ReadonlyArray<Asked> =>
  anchoredSymbols(file.node, file.symbols)
    .filter(({ item }) => item.scope === undefined)
    .flatMap(({ item, id }) => {
      const removal = removalOf(item, pathOf);
      if (removal !== undefined)
        return [
          { id, label: `${item.kind} ${removal.former}`, how: removal.how, name: removal.former },
        ];
      return item.signature !== undefined && item.exported.base === true
        ? [{ id, label: `${item.kind} ${item.name}`, how: 'signature changed', name: item.name }]
        : [];
    });

type ReadReachesOptions = {
  readonly sides: { readonly before: string; readonly after: string };
  readonly before: StacksReading;
  readonly symbols: ReadonlyArray<SymbolFile>;
  readonly measured: ReadonlyArray<MeasuredNode>;
  readonly changedPaths: ReadonlyArray<string>;
  readonly pathOf: (id: string) => string;
};

export const readReaches = async ({
  sides,
  before,
  symbols,
  measured,
  changedPaths,
  pathOf,
}: ReadReachesOptions): Promise<ReadonlyArray<Reach>> => {
  const changed = new Set(changedPaths);
  const read = await Promise.all(
    symbols.map(async (file): Promise<ReadonlyArray<Reach>> => {
      if ('unreadable' in file) return [];
      const reader = before.stacks.find(({ stack }) => stack === file.stack)?.reader;
      const basePath = measured.find(({ id }) => id === file.node)?.basePath;
      const node = before.graph.nodes.find(({ path }) => path === basePath);
      const asked = askedOf(file, pathOf);
      if (reader?.uses === undefined || node === undefined || asked.length === 0) return [];
      const { uses } = await reader.uses({
        base: sides.before,
        head: sides.after,
        graph: before.graph,
        node,
        names: asked.map(({ name }) => name),
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
      return asked.flatMap(({ name, ...reach }) => {
        const rows = rowsOf(name);
        return rows.length === 0 ? [] : [{ node: file.node, ...reach, uses: rows }];
      });
    }),
  );
  return read.flat();
};
