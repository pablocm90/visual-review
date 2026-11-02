import type { FileSymbols, ReadSymbol, SymbolKind } from './reader.ts';

export type SymbolChange =
  | 'added'
  | 'removed'
  | 'edited'
  | 'renamed'
  | 'moved'
  | 'formatting'
  | 'unchanged';

export type SymbolStatement = {
  readonly name: string;
  readonly scope?: string;
  readonly kind: SymbolKind;
  readonly exported: { readonly base?: boolean; readonly head?: boolean };
  readonly change: SymbolChange;
  readonly signature?: { readonly base: string; readonly head: string };
  readonly renamedFrom?: string;
  readonly probably?: true;
  readonly movedTo?: string;
  readonly movedFrom?: string;
};

export type ExportChanges = {
  readonly added: ReadonlyArray<string>;
  readonly removed: ReadonlyArray<string>;
};

export type KindOfChange = 'api' | 'logic' | 'formatting';

export type SymbolChanges = {
  readonly symbols: ReadonlyArray<SymbolStatement>;
  readonly exports: ExportChanges;
  readonly kind: KindOfChange;
};

const PROBABLY_RENAMED = 0.8;

type SymbolChangesOptions = {
  readonly before: FileSymbols;
  readonly after: FileSymbols;
};

type Keyed = Pick<ReadSymbol, 'name' | 'scope' | 'kind'>;

const sameSymbol = (one: Keyed, other: Keyed): boolean =>
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
    kind: before.astHash === after.astHash ? 'formatting' : 'logic',
    exports: {
      added: after.exports.filter(name => !before.exports.includes(name)),
      removed: before.exports.filter(name => !after.exports.includes(name)),
    },
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

type SidedFile = SymbolChangesOptions & { readonly node: string };

export type FileSymbolChanges = SymbolChanges & { readonly node: string };

type End = {
  readonly node: string;
  readonly statement: SymbolStatement;
  readonly symbol: ReadSymbol;
};

export const symbolChangesOf = (
  files: ReadonlyArray<SidedFile>,
): ReadonlyArray<FileSymbolChanges> => {
  const paired = files.map(({ node, before, after }) => {
    const sides: Partial<Record<SymbolChange, FileSymbols>> = { added: after, removed: before };
    const changes = symbolChanges({ before, after });
    const ends = changes.symbols.flatMap(statement => {
      const symbol = sides[statement.change]?.symbols.find(read => sameSymbol(read, statement));
      return symbol === undefined ? [] : [{ node, statement, symbol }];
    });
    return { node, changes, ends };
  });
  const ends = paired.flatMap(file => file.ends);
  const onlyEndOf = (end: End): End | undefined => {
    const [other, ...more] = ends.filter(
      other =>
        other.statement.change !== end.statement.change &&
        sameSymbol(other.symbol, end.symbol) &&
        other.symbol.bodyHash === end.symbol.bodyHash,
    );
    return more.length === 0 ? other : undefined;
  };
  const moved = (statement: SymbolStatement): Partial<SymbolStatement> => {
    const end = ends.find(end => end.statement === statement);
    const other = end && onlyEndOf(end);
    if (other === undefined || onlyEndOf(other) !== end) return {};
    return statement.change === 'removed'
      ? { change: 'moved', movedTo: other.node }
      : { change: 'moved', movedFrom: other.node };
  };
  return paired.map(({ node, changes }) => ({
    node,
    ...changes,
    symbols: changes.symbols.map(statement => ({ ...statement, ...moved(statement) })),
  }));
};
