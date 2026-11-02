import type { FileSymbols, ReadSymbol, SymbolKind } from './reader.ts';

export type SymbolChange = 'added' | 'removed' | 'edited' | 'formatting' | 'unchanged';

export type SymbolStatement = {
  readonly name: string;
  readonly scope?: string;
  readonly kind: SymbolKind;
  readonly exported: { readonly base?: boolean; readonly head?: boolean };
  readonly change: SymbolChange;
  readonly signature?: { readonly base: string; readonly head: string };
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

const changeOf = (old: ReadSymbol, symbol: ReadSymbol): SymbolChange => {
  if (old.textHash === symbol.textHash) return 'unchanged';
  return old.bodyHash === symbol.bodyHash && old.signatureHash === symbol.signatureHash
    ? 'formatting'
    : 'edited';
};

export const symbolChanges = ({ before, after }: SymbolChangesOptions): SymbolChanges => ({
  symbols: [
    ...after.symbols.map((symbol): SymbolStatement => {
      const old = before.symbols.find(candidate => sameSymbol(candidate, symbol));
      if (old === undefined) {
        return { ...named(symbol), exported: { head: symbol.exported }, change: 'added' };
      }
      return {
        ...named(symbol),
        exported: { base: old.exported, head: symbol.exported },
        change: changeOf(old, symbol),
        ...(old.signatureHash === symbol.signatureHash
          ? {}
          : { signature: { base: old.signature, head: symbol.signature } }),
      };
    }),
    ...before.symbols
      .filter(symbol => !after.symbols.some(candidate => sameSymbol(candidate, symbol)))
      .map(
        (symbol): SymbolStatement => ({
          ...named(symbol),
          exported: { base: symbol.exported },
          change: 'removed',
        }),
      ),
  ],
});
