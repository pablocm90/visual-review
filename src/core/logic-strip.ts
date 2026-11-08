import { anchorKey } from './anchors.ts';
import type { LogicLine } from './logic-diff.ts';
import { SYMBOL_GROUPS, type SymbolStatement } from './symbol-changes.ts';
import { anchoredSymbols, decisionsOf } from './symbol-findings.ts';

const FEW_CHANGES = 8;

const EXITS: ReadonlySet<LogicLine['kind']> = new Set(['guard', 'return', 'throw', 'catch']);

export const isExit = ({ change, kind }: LogicLine): boolean =>
  change !== 'same' && EXITS.has(kind);

export const countsOf = (
  logic: ReadonlyArray<LogicLine>,
): { readonly changed: number; readonly exits: number } => ({
  changed: logic.filter(({ change }) => change !== 'same').length,
  exits: logic.filter(isExit).length,
});

type WithLogic = { readonly logic?: ReadonlyArray<LogicLine> };

const changedIn = (symbols: ReadonlyArray<WithLogic>): number =>
  countsOf(symbols.flatMap(({ logic }) => logic ?? [])).changed;

export const holdsFewChanges = (symbols: ReadonlyArray<WithLogic>): boolean =>
  changedIn(symbols) <= FEW_CHANGES;

export type RowRun<Row> = {
  readonly unchanged: boolean;
  readonly rows: ReadonlyArray<Row>;
};

export const runsOf = <Row extends { readonly line: LogicLine }>(
  rows: ReadonlyArray<Row>,
): ReadonlyArray<RowRun<Row>> => {
  const isUnchanged = ({ line }: Row): boolean => line.change === 'same';
  const [first] = rows;
  if (first === undefined) return [];
  const unchanged = isUnchanged(first);
  const end = rows.findIndex(row => isUnchanged(row) !== unchanged);
  return end === -1
    ? [{ unchanged, rows }]
    : [{ unchanged, rows: rows.slice(0, end) }, ...runsOf(rows.slice(end))];
};

type FileWithLogic =
  | { readonly node: string; readonly symbols: ReadonlyArray<WithLogic> }
  | { readonly node: string; readonly unreadable: string };

export const nodesWithChangedLogic = (files: ReadonlyArray<FileWithLogic>): ReadonlyArray<string> =>
  files.flatMap(file => ('symbols' in file && changedIn(file.symbols) > 0 ? [file.node] : []));

export type LogicTotals = {
  readonly decisions: number;
  readonly functions: number;
  readonly files: number;
  readonly exits: number;
  readonly added: number;
  readonly changed: number;
  readonly removed: number;
  readonly moved: number;
};

export const logicTotalsOf = (files: ReadonlyArray<FileWithLogic>): LogicTotals => {
  const functions = files
    .flatMap(file => ('symbols' in file ? file.symbols : []))
    .filter(symbol => changedIn([symbol]) > 0);
  const lines = functions.flatMap(({ logic }) => logic ?? []);
  const counting = (change: LogicLine['change']): number =>
    lines.filter(line => line.change === change).length;
  const { changed: decisions, exits } = countsOf(lines);
  return {
    decisions,
    functions: functions.length,
    files: nodesWithChangedLogic(files).length,
    exits,
    added: counting('added'),
    changed: counting('changed'),
    removed: counting('removed'),
    moved: counting('moved'),
  };
};

export type WalkedDecision = {
  readonly node: string;
  readonly row: string;
  readonly changed: boolean;
};

export const walkOfDecisions = ({
  files,
  parts,
}: {
  readonly files: ReadonlyArray<
    | { readonly node: string; readonly symbols: ReadonlyArray<SymbolStatement> }
    | { readonly node: string; readonly unreadable: string }
  >;
  readonly parts: ReadonlyArray<string>;
}): ReadonlyArray<WalkedDecision> => {
  const rank = (node: string): number =>
    parts.includes(node) ? parts.indexOf(node) : parts.length;
  return files
    .toSorted((one, other) => rank(one.node) - rank(other.node))
    .flatMap(file =>
      'symbols' in file
        ? SYMBOL_GROUPS.flatMap(([, holds]) =>
            anchoredSymbols(file.node, file.symbols).filter(({ item }) => holds(item)),
          ).flatMap(symbol =>
            decisionsOf(symbol).map(({ id, line }) => ({
              node: file.node,
              row: anchorKey({ kind: 'decision', id }),
              changed: line.change !== 'same',
            })),
          )
        : [],
    );
};

export const nextDecision = ({
  walk,
  selected,
  row,
}: {
  readonly walk: ReadonlyArray<WalkedDecision>;
  readonly selected?: string | undefined;
  readonly row?: string | undefined;
}): WalkedDecision | undefined => {
  const landed = walk.findIndex(decision => decision.row === row);
  if (landed !== -1) return walk.slice(landed + 1).find(({ changed }) => changed);
  const changed = walk.filter(decision => decision.changed);
  return changed.find(({ node }) => node === selected) ?? changed[0];
};
