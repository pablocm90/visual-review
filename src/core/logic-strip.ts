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

export const holdsFewChanges = (
  symbols: ReadonlyArray<{ readonly logic?: ReadonlyArray<LogicLine> }>,
): boolean => countsOf(symbols.flatMap(({ logic }) => logic ?? [])).changed <= FEW_CHANGES;
