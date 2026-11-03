import type { Decision, DecisionKind } from './reader.ts';

export type LogicLine = {
  readonly change: 'same' | 'added' | 'removed' | 'changed';
  readonly kind: DecisionKind;
  readonly depth: number;
  readonly base?: string;
  readonly head?: string;
  readonly line: number;
};

type Sides = {
  readonly base: ReadonlyArray<Decision>;
  readonly head: ReadonlyArray<Decision>;
};

type Match = readonly [number, number];

const sameDecision = (one: Decision, other: Decision): boolean =>
  one.kind === other.kind && one.text === other.text;

type Row = ReadonlyArray<number>;

const rowFrom = (decision: Decision, head: Sides['head'], next: Row, column: number): Row => {
  const other = head[column];
  if (other === undefined) return [0];
  const right = rowFrom(decision, head, next, column + 1);
  const length = sameDecision(decision, other)
    ? (next[column + 1] ?? 0) + 1
    : Math.max(next[column] ?? 0, right[0] ?? 0);
  return [length, ...right];
};

const lengthsFrom = ({ base, head }: Sides, row: number): ReadonlyArray<Row> => {
  const decision = base[row];
  if (decision === undefined) return [[...head.map(() => 0), 0]];
  const below = lengthsFrom({ base, head }, row + 1);
  return [rowFrom(decision, head, below[0] ?? [], 0), ...below];
};

const matchesFrom = (
  sides: Sides,
  lengths: ReadonlyArray<Row>,
  [row, column]: Match,
): ReadonlyArray<Match> => {
  const decision = sides.base[row];
  const other = sides.head[column];
  if (decision === undefined || other === undefined) return [];
  if (sameDecision(decision, other))
    return [[row, column], ...matchesFrom(sides, lengths, [row + 1, column + 1])];
  const down = lengths[row + 1]?.[column] ?? 0;
  const right = lengths[row]?.[column + 1] ?? 0;
  return matchesFrom(sides, lengths, down >= right ? [row + 1, column] : [row, column + 1]);
};

const removed = (decision: Decision): LogicLine => ({
  change: 'removed',
  kind: decision.kind,
  depth: decision.depth,
  base: decision.text,
  line: decision.line,
});

const ofHead = (change: 'same' | 'added', decision: Decision): LogicLine => ({
  change,
  kind: decision.kind,
  depth: decision.depth,
  head: decision.text,
  line: decision.line,
});

const changed = (old: Decision, decision: Decision): LogicLine => ({
  change: 'changed',
  kind: decision.kind,
  depth: decision.depth,
  base: old.text,
  head: decision.text,
  line: decision.line,
});

const sameKindBefore = (decisions: ReadonlyArray<Decision>, index: number): number =>
  decisions.slice(0, index).filter(({ kind }) => kind === decisions[index]?.kind).length;

const linesOfGap = ({ base, head }: Sides): ReadonlyArray<LogicLine> => {
  const partners = head.map(
    (decision, index) =>
      base.filter(({ kind }) => kind === decision.kind)[sameKindBefore(head, index)],
  );
  return [
    ...base.filter(decision => !partners.includes(decision)).map(removed),
    ...head.map((decision, index) => {
      const partner = partners[index];
      return partner ? changed(partner, decision) : ofHead('added', decision);
    }),
  ];
};

type Walked = { readonly lines: ReadonlyArray<LogicLine>; readonly from: Match };

export const logicDiff = (sides: Sides): ReadonlyArray<LogicLine> => {
  const matches = matchesFrom(sides, lengthsFrom(sides, 0), [0, 0]);
  const { lines, from } = matches.reduce<Walked>(
    (walked, [row, column]) => ({
      lines: [
        ...walked.lines,
        ...linesOfGap({
          base: sides.base.slice(walked.from[0], row),
          head: sides.head.slice(walked.from[1], column),
        }),
        ...sides.head.slice(column, column + 1).map(decision => ofHead('same', decision)),
      ],
      from: [row + 1, column + 1],
    }),
    { lines: [], from: [0, 0] },
  );
  return [
    ...lines,
    ...linesOfGap({ base: sides.base.slice(from[0]), head: sides.head.slice(from[1]) }),
  ];
};
