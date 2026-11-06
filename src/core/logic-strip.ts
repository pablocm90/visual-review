import type { LogicLine } from './logic-diff.ts';

const EXITS: ReadonlySet<LogicLine['kind']> = new Set(['guard', 'return', 'throw', 'catch']);

export const isExit = ({ change, kind }: LogicLine): boolean =>
  change !== 'same' && EXITS.has(kind);

export const countsOf = (
  logic: ReadonlyArray<LogicLine>,
): { readonly changed: number; readonly exits: number } => ({
  changed: logic.filter(({ change }) => change !== 'same').length,
  exits: logic.filter(isExit).length,
});
