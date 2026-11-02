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
  readonly probably?: true;
};

export type SymbolChanges = {
  readonly symbols: ReadonlyArray<SymbolStatement>;
};

const PROBABLY_RENAMED = 0.8;

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

const bigramsOf = (tokens: ReadonlyArray<string>): ReadonlyArray<string> =>
  tokens.slice(1).map((token, index) => `${tokens[index]} ${token}`);

const similarity = (one: ReadSymbol, other: ReadSymbol): number => {
  const bigrams = bigramsOf(one.bodyTokens);
  const others = bigramsOf(other.bodyTokens);
  const counted = Map.groupBy(others, bigram => bigram);
  const shared = [...Map.groupBy(bigrams, bigram => bigram)].reduce(
    (sum, [bigram, all]) => sum + Math.min(all.length, counted.get(bigram)?.length ?? 0),
    0,
  );
  return (2 * shared) / (bigrams.length + others.length);
};

const likenessOf = (former: ReadSymbol, symbol: ReadSymbol): number =>
  former.bodyHash === symbol.bodyHash ? 1 : similarity(former, symbol);

const pairedWith = (old: ReadSymbol, symbol: ReadSymbol): SymbolStatement => ({
  ...named(symbol),
  exported: { base: old.exported, head: symbol.exported },
  change: changeOf(old, symbol),
  ...(old.signatureHash === symbol.signatureHash
    ? {}
    : { signature: { base: old.signature, head: symbol.signature } }),
});

type Rename = {
  readonly symbol: ReadSymbol;
  readonly former: ReadSymbol;
  readonly likeness: number;
};

const byLikenessThenNames = (one: Rename, other: Rename): number =>
  other.likeness - one.likeness ||
  qualified(one.symbol).localeCompare(qualified(other.symbol)) ||
  qualified(one.former).localeCompare(qualified(other.former));

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
          .filter(former => former.kind === symbol.kind)
          .map(former => ({ symbol, former, likeness: likenessOf(former, symbol) })),
      )
      .filter(({ likeness }) => likeness >= PROBABLY_RENAMED)
      .toSorted(byLikenessThenNames)
      .reduce<ReadonlyArray<Rename>>(
        (taken, rename) =>
          taken.some(({ symbol, former }) => symbol === rename.symbol || former === rename.former)
            ? taken
            : taken.concat([rename]),
        [],
      )
      .map(({ symbol, former }) => [symbol, former] as const),
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
            ...(former.bodyHash === symbol.bodyHash ? {} : { probably: true }),
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
