import { decisionKey, decisionText, type LogicLine, logicDiff } from './logic-diff.ts';
import type { FileSymbols, LineRange, ReadSymbol, SymbolKind } from './reader.ts';

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
  readonly lines: { readonly base?: LineRange; readonly head?: LineRange };
  readonly exported: { readonly base?: boolean; readonly head?: boolean };
  readonly change: SymbolChange;
  readonly signature?: { readonly base: string; readonly head: string };
  readonly renamedFrom?: string;
  readonly probably?: true;
  readonly movedTo?: string;
  readonly movedFrom?: string;
  readonly logic?: ReadonlyArray<LogicLine>;
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
  readonly blindSpots?: ReadonlyArray<string>;
};

const PROBABLY_RENAMED = 0.8;

type SymbolChangesOptions = {
  readonly before: FileSymbols;
  readonly after: FileSymbols;
};

type Keyed = Pick<ReadSymbol, 'name' | 'scope' | 'kind'>;

const samePlace = (one: Keyed, other: Keyed): boolean =>
  one.name === other.name && one.scope === other.scope;

const sameSymbol = (one: Keyed, other: Keyed): boolean =>
  one.kind === other.kind && samePlace(one, other);

const isAccessor = ({ kind }: Pick<Keyed, 'kind'>): boolean =>
  kind === 'getter' || kind === 'setter';

const turnedInto = (one: Pick<Keyed, 'kind'>, other: Pick<Keyed, 'kind'>): boolean =>
  (one.kind === 'method' && isAccessor(other)) || (isAccessor(one) && other.kind === 'method');

const named = ({ name, scope, kind }: ReadSymbol) =>
  scope === undefined ? { name, kind } : { name, scope, kind };

export const qualified = ({ scope, name }: Pick<ReadSymbol, 'scope' | 'name'>): string =>
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

const logicOf = (old: ReadSymbol, symbol: ReadSymbol) => {
  const logic = logicDiff({ base: old.decisions ?? [], head: symbol.decisions ?? [] });
  return logic.every(({ change }) => change === 'same') ? {} : { logic };
};

const pairedWith = (old: ReadSymbol, symbol: ReadSymbol): SymbolStatement => ({
  ...named(symbol),
  lines: { base: old.lines, head: symbol.lines },
  exported: { base: old.exported, head: symbol.exported },
  change: changeOf(old, symbol),
  ...(old.signatureHash === symbol.signatureHash
    ? {}
    : { signature: { base: old.signature, head: symbol.signature } }),
  ...logicOf(old, symbol),
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

export const changesApi = ({ exported, change, signature }: SymbolStatement): boolean =>
  (exported.base === true || exported.head === true) &&
  (signature !== undefined || change === 'renamed' || exported.base !== exported.head);

const ofChange =
  (change: SymbolChange) =>
  (symbol: SymbolStatement): boolean =>
    !changesApi(symbol) && symbol.change === change;

export const SYMBOL_GROUPS: ReadonlyArray<readonly [string, (symbol: SymbolStatement) => boolean]> =
  [
    ['API', changesApi],
    ['Edited', ofChange('edited')],
    ['Renamed', ofChange('renamed')],
    ['Moved', ofChange('moved')],
    ['Added', ofChange('added')],
    ['Removed', ofChange('removed')],
  ];

export const isQuiet = (symbol: SymbolStatement): boolean =>
  !changesApi(symbol) && (symbol.change === 'unchanged' || symbol.change === 'formatting');

const kindOf = ({
  before,
  after,
  exports,
  symbols,
}: SymbolChangesOptions & Omit<SymbolChanges, 'kind'>): KindOfChange => {
  if (exports.added.length > 0 || exports.removed.length > 0) return 'api';
  if (symbols.some(changesApi)) return 'api';
  return before.astHash === after.astHash ? 'formatting' : 'logic';
};

const turnedSymbols = (
  unpaired: ReadonlyArray<ReadSymbol>,
  newcomers: ReadonlyArray<ReadSymbol>,
): ReadonlyMap<ReadSymbol, ReadSymbol> =>
  new Map(
    newcomers.reduce<ReadonlyArray<readonly [ReadSymbol, ReadSymbol]>>((turned, symbol) => {
      const former = unpaired.find(
        candidate =>
          !turned.some(([, taken]) => taken === candidate) &&
          samePlace(candidate, symbol) &&
          turnedInto(candidate, symbol),
      );
      return former === undefined ? turned : turned.concat([[symbol, former]]);
    }, []),
  );

const namedAlike = (symbol: ReadSymbol, { symbols }: FileSymbols): ReadonlyArray<ReadSymbol> =>
  symbols.filter(candidate => sameSymbol(candidate, symbol));

const counterpart = (
  symbol: ReadSymbol,
  from: FileSymbols,
  to: FileSymbols,
): ReadSymbol | undefined => namedAlike(symbol, to)[namedAlike(symbol, from).indexOf(symbol)];

type ReadStatement = { readonly statement: SymbolStatement; readonly read: ReadSymbol };

const readStatements = ({ before, after }: SymbolChangesOptions): ReadonlyArray<ReadStatement> => {
  const unpaired = before.symbols.filter(
    symbol => counterpart(symbol, before, after) === undefined,
  );
  const keptFrom = (symbol: ReadSymbol) => counterpart(symbol, after, before);
  const turned = turnedSymbols(
    unpaired,
    after.symbols.filter(symbol => keptFrom(symbol) === undefined),
  );
  const formers = new Set(turned.values());
  const removed = unpaired.filter(symbol => !formers.has(symbol));
  const partnerOf = (symbol: ReadSymbol) => keptFrom(symbol) ?? turned.get(symbol);
  const renames = new Map(
    after.symbols
      .filter(symbol => partnerOf(symbol) === undefined)
      .flatMap(symbol =>
        removed
          .filter(former => former.kind === symbol.kind || turnedInto(former, symbol))
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
  const headStatement = (symbol: ReadSymbol): SymbolStatement => {
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
    return {
      ...named(symbol),
      lines: { head: symbol.lines },
      exported: { head: symbol.exported },
      change: 'added',
    };
  };
  return [
    ...after.symbols.map(read => ({ statement: headStatement(read), read })),
    ...removed
      .filter(symbol => !renamed.has(symbol))
      .map(read => ({
        statement: {
          ...named(read),
          lines: { base: read.lines },
          exported: { base: read.exported },
          change: 'removed' as const,
        },
        read,
      })),
  ];
};

const changesOf = (
  { before, after }: SymbolChangesOptions,
  statements: ReadonlyArray<ReadStatement>,
): SymbolChanges => {
  const symbols = statements.map(({ statement }) => statement);
  const exports = {
    added: after.exports.filter(name => !before.exports.includes(name)),
    removed: before.exports.filter(name => !after.exports.includes(name)),
  };
  return {
    symbols,
    exports,
    kind: kindOf({ before, after, exports, symbols }),
    ...(after.blindSpots ? { blindSpots: after.blindSpots } : {}),
  };
};

export const symbolChanges = (options: SymbolChangesOptions): SymbolChanges =>
  changesOf(options, readStatements(options));

type SidedFile = SymbolChangesOptions & { readonly node: string };

export type FileSymbolChanges = SymbolChanges & { readonly node: string };

type End = ReadStatement & { readonly node: string };

type Gain = { readonly key: string; readonly owner: SymbolStatement; readonly node: string };

const gainsOf = ({ statement, read }: ReadStatement, node: string): ReadonlyArray<Gain> => {
  const decisions =
    statement.change === 'added'
      ? (read.decisions ?? [])
      : (statement.logic ?? [])
          .filter(({ change }) => change === 'added')
          .map(line => ({ kind: line.kind, text: decisionText(line) }));
  return decisions.map(decision => ({ key: decisionKey(decision), owner: statement, node }));
};

type Settled = { readonly node: string; readonly statements: ReadonlyArray<ReadStatement> };

const heldByRemoved = ({ statements }: Settled): ReadonlyArray<string> =>
  statements
    .filter(({ statement }) => statement.change === 'removed')
    .flatMap(({ read }) => read.decisions ?? [])
    .map(decisionKey);

const withoutOne = (gains: ReadonlyArray<Gain>, key: string): ReadonlyArray<Gain> => {
  const at = gains.findIndex(gain => gain.key === key);
  return at === -1 ? gains : gains.toSpliced(at, 1);
};

const movesOf = (files: ReadonlyArray<Settled>): ReadonlyMap<LogicLine, Gain> => {
  const gains = Map.groupBy(
    files.flatMap(heldByRemoved).reduce(
      withoutOne,
      files.flatMap(({ node, statements }) => statements.flatMap(read => gainsOf(read, node))),
    ),
    ({ key }) => key,
  );
  const lost = files
    .flatMap(({ statements }) => statements)
    .flatMap(({ statement: owner }) =>
      (owner.logic ?? [])
        .filter(({ change }) => change === 'removed')
        .map(line => ({ owner, line })),
    );
  return new Map(
    lost.reduce<ReadonlyArray<readonly [LogicLine, Gain]>>((moves, { owner, line }) => {
      const gain = gains
        .get(decisionKey({ kind: line.kind, text: decisionText(line) }))
        ?.find(gain => gain.owner !== owner && !moves.some(([, taken]) => taken === gain));
      return gain === undefined ? moves : moves.concat([[line, gain]]);
    }, []),
  );
};

const withMoves = (
  statement: SymbolStatement,
  node: string,
  moves: ReadonlyMap<LogicLine, Gain>,
): SymbolStatement =>
  statement.logic === undefined
    ? statement
    : {
        ...statement,
        logic: statement.logic.map(line => {
          const gain = moves.get(line);
          return gain === undefined
            ? line
            : {
                ...line,
                change: 'moved',
                movedTo: qualified(gain.owner),
                ...(gain.node === node ? {} : { movedToNode: gain.node }),
              };
        }),
      };

export const symbolChangesOf = (
  files: ReadonlyArray<SidedFile>,
): ReadonlyArray<FileSymbolChanges> => {
  const paired = files.map(({ node, before, after }) => {
    const statements = readStatements({ before, after });
    return { node, statements, changes: changesOf({ before, after }, statements) };
  });
  const ends = paired.flatMap(({ node, statements }) =>
    statements
      .filter(({ statement }) => statement.change === 'added' || statement.change === 'removed')
      .map(end => ({ ...end, node })),
  );
  const onlyEndOf = (end: End): End | undefined => {
    const [other, ...more] = ends.filter(
      other =>
        other.statement.change !== end.statement.change &&
        sameSymbol(other.read, end.read) &&
        other.read.bodyHash === end.read.bodyHash,
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
  const settled = paired.map(({ node, statements, changes }) => ({
    node,
    changes,
    statements: statements.map(({ statement, read }) => ({
      statement: { ...statement, ...moved(statement) },
      read,
    })),
  }));
  const moves = movesOf(settled);
  return settled.map(({ node, changes, statements }) => ({
    node,
    ...changes,
    symbols: statements.map(({ statement }) => withMoves(statement, node, moves)),
  }));
};
