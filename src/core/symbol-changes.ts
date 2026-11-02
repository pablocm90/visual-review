import type { FileSymbols, ReadSymbol, SymbolKind } from './reader.ts';

export type SymbolChange = 'added' | 'removed' | 'edited' | 'renamed' | 'formatting' | 'unchanged';

export type SymbolStatement = {
  readonly name: string;
  readonly scope?: string;
  readonly kind: SymbolKind;
  readonly exported: { readonly base?: boolean; readonly head?: boolean };
  readonly change: SymbolChange;
  readonly signature?: { readonly base: string; readonly head: string };
  readonly renamedFrom?: string;
};

export type SymbolChanges = {
  readonly symbols: ReadonlyArray<SymbolStatement>;
};

type SymbolChangesOptions = {
  readonly before: FileSymbols;
  readonly after: FileSymbols;
};

const sameSymbol = (one: ReadSymbol, other: ReadSymbol): boolean =>
  one.kind === other.kind && one.name === other.name && one.scope === other.scope;

const named = ({ name, scope, kind }: ReadSymbol) =>
  scope === undefined ? { name, kind } : { name, scope, kind };

const qualified = ({ scope, name }: ReadSymbol): string =>
  scope === undefined ? name : `${scope}.${name}`;

const changeOf = (old: ReadSymbol, symbol: ReadSymbol): SymbolChange => {
  if (old.textHash === symbol.textHash) return 'unchanged';
  return old.bodyHash === symbol.bodyHash && old.signatureHash === symbol.signatureHash
    ? 'formatting'
    : 'edited';
};

const isRenamed = (old: ReadSymbol, symbol: ReadSymbol): boolean =>
  old.kind === symbol.kind && old.bodyHash === symbol.bodyHash;

const pairedWith = (old: ReadSymbol, symbol: ReadSymbol): SymbolStatement => ({
  ...named(symbol),
  exported: { base: old.exported, head: symbol.exported },
  change: changeOf(old, symbol),
  ...(old.signatureHash === symbol.signatureHash
    ? {}
    : { signature: { base: old.signature, head: symbol.signature } }),
});

type Rename = readonly [symbol: ReadSymbol, former: ReadSymbol];

const byNames = ([symbol, former]: Rename, [other, otherFormer]: Rename): number =>
  qualified(symbol).localeCompare(qualified(other)) ||
  qualified(former).localeCompare(qualified(otherFormer));

export const symbolChanges = ({ before, after }: SymbolChangesOptions): SymbolChanges => {
  const removed = before.symbols.filter(
    symbol => !after.symbols.some(candidate => sameSymbol(candidate, symbol)),
  );
  const partnerOf = (symbol: ReadSymbol) =>
    before.symbols.find(candidate => sameSymbol(candidate, symbol));
  const renames = new Map(
    after.symbols
      .filter(symbol => partnerOf(symbol) === undefined)
      .flatMap(symbol =>
        removed
          .filter(former => isRenamed(former, symbol))
          .map(former => [symbol, former] as const),
      )
      .toSorted(byNames)
      .reduce<ReadonlyArray<Rename>>(
        (taken, [symbol, former]) =>
          taken.some(([head, base]) => head === symbol || base === former)
            ? taken
            : taken.concat([[symbol, former]]),
        [],
      ),
  );
  const renamed = new Set(renames.values());
  return {
    symbols: [
      ...after.symbols.map((symbol): SymbolStatement => {
        const old = partnerOf(symbol);
        if (old !== undefined) return pairedWith(old, symbol);
        const former = renames.get(symbol);
        if (former !== undefined) {
          return {
            ...pairedWith(former, symbol),
            change: 'renamed',
            renamedFrom: qualified(former),
          };
        }
        return { ...named(symbol), exported: { head: symbol.exported }, change: 'added' };
      }),
      ...removed
        .filter(symbol => !renamed.has(symbol))
        .map(
          (symbol): SymbolStatement => ({
            ...named(symbol),
            exported: { base: symbol.exported },
            change: 'removed',
          }),
        ),
    ],
  };
};
