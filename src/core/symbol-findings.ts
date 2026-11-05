import { countedId } from './counted-id.ts';
import type { Finding } from './findings.ts';
import type { GraphNode } from './graph.ts';
import { decisionText, type LogicLine } from './logic-diff.ts';
import type { SymbolFile } from './read-range.ts';
import { signatureSummary } from './signature-members.ts';
import { type FileSymbolChanges, qualified, type SymbolStatement } from './symbol-changes.ts';

type Removal = { readonly former: string; readonly how: string; readonly detail?: string };

type PathOf = (id: string) => string;

const removalOf = (statement: SymbolStatement, pathOf: PathOf): Removal | undefined => {
  if (statement.exported.base !== true) return undefined;
  const name = qualified(statement);
  if (statement.renamedFrom !== undefined) {
    const former = statement.renamedFrom;
    return statement.probably
      ? { former, how: `probably renamed to ${name}`, detail: 'found by body similarity' }
      : { former, how: `renamed to ${name}` };
  }
  if (statement.movedTo !== undefined)
    return { former: name, how: `moved to ${pathOf(statement.movedTo)}` };
  if (statement.change === 'removed') return { former: name, how: 'removed' };
  return statement.exported.head === false
    ? { former: name, how: 'no longer exported' }
    : undefined;
};

const addedHow = ({ change, movedFrom }: SymbolStatement, pathOf: PathOf): string => {
  if (change === 'added') return 'added';
  return movedFrom === undefined ? 'now exported' : `moved from ${pathOf(movedFrom)}`;
};

const isAddedExport = ({ exported }: SymbolStatement): boolean =>
  exported.base !== true && exported.head === true;

const raisesItsOwn = (statement: SymbolStatement): boolean =>
  removalOf(statement, id => id) !== undefined || isAddedExport(statement);

const unheld = (symbols: ReadonlyArray<AnchoredSymbol>): ReadonlyArray<AnchoredSymbol> => {
  const holders = new Set(
    symbols
      .map(({ item }) => item)
      .filter(raisesItsOwn)
      .map(qualified),
  );
  return symbols.filter(({ item: { scope } }) => scope === undefined || !holders.has(scope));
};

type Placed = {
  readonly node: string;
  readonly symbol: AnchoredSymbol;
  readonly pathOf: PathOf;
};

const findingOf = ({
  node,
  symbol: { item: statement, id },
  pathOf,
}: Placed): Finding | undefined => {
  const removal = removalOf(statement, pathOf);
  const on = { dimension: 'api', level: 'look', target: node } as const;
  if (removal !== undefined)
    return {
      id: `api:removed:${id}`,
      check: 'api:removed',
      ...on,
      title: `${statement.kind} ${removal.former} ${removal.how}`,
      ...(removal.detail === undefined ? {} : { detail: removal.detail }),
    };
  const { signature, exported } = statement;
  const name = qualified(statement);
  if (isAddedExport(statement))
    return {
      id: `api:added:${id}`,
      check: 'api:added',
      ...on,
      level: 'info',
      title: `${statement.kind} ${name} ${addedHow(statement, pathOf)}`,
    };
  if (signature === undefined || exported.base !== true) return undefined;
  return {
    id: `api:signature:${id}`,
    check: 'api:signature',
    ...on,
    title: `${statement.kind} ${name}'s signature changed`,
    detail: signatureSummary(signature),
  };
};

const exportsFinding = (file: FileSymbolChanges): ReadonlyArray<Finding> => {
  const behind = new Set(
    file.symbols
      .filter(raisesItsOwn)
      .flatMap(statement => [qualified(statement), statement.renamedFrom]),
  );
  const unbacked = (names: ReadonlyArray<string>) => names.filter(name => !behind.has(name));
  const removed = unbacked(file.exports.removed);
  const added = unbacked(file.exports.added);
  const parts = [
    ...(removed.length === 0 ? [] : [`removed ${removed.join(', ')}`]),
    ...(added.length === 0 ? [] : [`added ${added.join(', ')}`]),
  ];
  if (parts.length === 0) return [];
  return [
    {
      id: `api:exports:${file.node}`,
      check: 'api:exports',
      dimension: 'api',
      level: removed.length === 0 ? 'info' : 'look',
      target: file.node,
      title: 'export list changed',
      detail: parts.join('; '),
    },
  ];
};

const isLost = ({ change, kind }: LogicLine): boolean =>
  change === 'removed' && (kind === 'guard' || kind === 'catch');

const COUNTED = [
  ['added', 'added'],
  ['changed', 'changed'],
  ['removed', 'removed'],
  ['moved', 'moved (found by text)'],
] as const;

const changedFinding = (
  node: string,
  { item: statement, id }: AnchoredSymbol,
  others: ReadonlyArray<LogicLine>,
): ReadonlyArray<Finding> => {
  if (others.length === 0) return [];
  const counts = COUNTED.map(
    ([change, words]) => [words, others.filter(line => line.change === change).length] as const,
  );
  return [
    {
      id: `logic:changed:${id}`,
      check: 'logic:changed',
      dimension: 'logic',
      level: 'info',
      target: node,
      title: `${statement.kind} ${qualified(statement)} changed its logic`,
      detail: counts
        .filter(([, count]) => count > 0)
        .map(([words, count]) => `${count} ${words}`)
        .join(', '),
    },
  ];
};

const countingRepeats = <T>(
  items: ReadonlyArray<T>,
  idOf: (item: T) => string,
): ReadonlyArray<{ readonly item: T; readonly id: string }> =>
  items.map((item, index) => {
    const id = idOf(item);
    const before = items.slice(0, index).filter(other => idOf(other) === id).length;
    return { item, id: countedId(id, before) };
  });

export type AnchoredSymbol = {
  readonly item: SymbolStatement;
  readonly id: string;
};

export const anchoredSymbols = (
  node: string,
  symbols: ReadonlyArray<SymbolStatement>,
): ReadonlyArray<AnchoredSymbol> =>
  countingRepeats(symbols, symbol => `${node}#${qualified(symbol)}`);

export const decisionsOf = ({ item: statement, id: symbolId }: AnchoredSymbol) =>
  countingRepeats(statement.logic ?? [], line => `${symbolId}#${decisionText(line)}`).map(
    ({ item, id }) => ({ line: item, id, text: decisionText(item) }),
  );

const LOST_DECISION = 'logic:removed:';

export const decisionOfLost = (findingId: string): string | undefined =>
  findingId.startsWith(LOST_DECISION) ? findingId.slice(LOST_DECISION.length) : undefined;

const logicFindings = (node: string, symbol: AnchoredSymbol): ReadonlyArray<Finding> => {
  const statement = symbol.item;
  const name = qualified(statement);
  const lines = statement.logic ?? [];
  return [
    ...decisionsOf(symbol).flatMap(({ line, id }) =>
      isLost(line)
        ? [
            {
              id: `${LOST_DECISION}${id}`,
              check: 'logic:removed' as const,
              dimension: 'logic' as const,
              level: 'look' as const,
              target: node,
              title: `${statement.kind} ${name} lost a ${line.kind}`,
              detail: `${line.base ?? ''}${line.foundByName ? ' (found by name)' : ''}`,
            },
          ]
        : [],
    ),
    ...changedFinding(
      node,
      symbol,
      lines.filter(line => line.change !== 'same' && !isLost(line)),
    ),
  ];
};

const BLIND_SPOT = 'logic:blind-spot:';

export const isLogicBlindSpot = ({ id }: Pick<Finding, 'id'>): boolean => id.startsWith(BLIND_SPOT);

const blindSpotFinding = ({ node, blindSpots = [] }: FileSymbolChanges): ReadonlyArray<Finding> =>
  blindSpots.length === 0
    ? []
    : [
        {
          id: `${BLIND_SPOT}${node}`,
          check: 'logic:blind-spot',
          dimension: 'logic',
          level: 'info',
          target: node,
          title: `logic not read through: ${blindSpots.join(', ')}`,
        },
      ];

type SymbolFindingsOptions = {
  readonly files: ReadonlyArray<SymbolFile>;
  readonly nodes: ReadonlyArray<GraphNode>;
};

export const symbolFindings = ({ files, nodes }: SymbolFindingsOptions): ReadonlyArray<Finding> => {
  const pathOf = (id: string) => nodes.find(node => node.id === id)?.path ?? id;
  return files.flatMap(file =>
    'unreadable' in file
      ? [
          {
            id: `structure:unreadable-symbols:${file.node}`,
            check: 'structure:unreadable-symbols',
            dimension: 'structure',
            level: 'info',
            target: file.node,
            title: 'symbols not read',
            detail: file.unreadable,
          },
        ]
      : [
          ...unheld(anchoredSymbols(file.node, file.symbols)).flatMap(
            symbol => findingOf({ node: file.node, symbol, pathOf }) ?? [],
          ),
          ...exportsFinding(file),
          ...anchoredSymbols(file.node, file.symbols).flatMap(symbol =>
            logicFindings(file.node, symbol),
          ),
          ...blindSpotFinding(file),
        ],
  );
};
