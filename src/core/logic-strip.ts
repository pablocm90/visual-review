import type { LogicLine } from './logic-diff.ts';

export type StripMark = {
  readonly change: LogicLine['change'];
  readonly exit: boolean;
};

export type LogicStrip = {
  readonly marks: ReadonlyArray<StripMark>;
  readonly changed: number;
  readonly exits: number;
};

const EXITS: ReadonlySet<LogicLine['kind']> = new Set(['guard', 'return', 'throw', 'catch']);

const markOf = ({ change, kind }: LogicLine): StripMark => ({
  change,
  exit: change !== 'same' && EXITS.has(kind),
});

export const stripOf = (logic: ReadonlyArray<LogicLine>): LogicStrip => {
  const marks = logic.map(markOf);
  return {
    marks,
    changed: marks.filter(({ change }) => change !== 'same').length,
    exits: marks.filter(({ exit }) => exit).length,
  };
};
