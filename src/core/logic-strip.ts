import type { LogicLine } from './logic-diff.ts';

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
