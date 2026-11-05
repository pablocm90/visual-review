type Sides<T> = {
  readonly base: ReadonlyArray<T>;
  readonly head: ReadonlyArray<T>;
};

type Comparing<T> = Sides<T> & { readonly same: (one: T, other: T) => boolean };

export type AlignedRun<T> = { readonly kept: T } | Sides<T>;

type Match = readonly [number, number];

type Row = ReadonlyArray<number>;

const rowFrom = <T>(item: T, sides: Comparing<T>, next: Row, column: number): Row => {
  const other = sides.head[column];
  if (other === undefined) return [0];
  const right = rowFrom(item, sides, next, column + 1);
  const length = sides.same(item, other)
    ? (next[column + 1] ?? 0) + 1
    : Math.max(next[column] ?? 0, right[0] ?? 0);
  return [length, ...right];
};

const lengthsFrom = <T>(sides: Comparing<T>, row: number): ReadonlyArray<Row> => {
  const item = sides.base[row];
  if (item === undefined) return [[...sides.head.map(() => 0), 0]];
  const below = lengthsFrom(sides, row + 1);
  return [rowFrom(item, sides, below[0] ?? [], 0), ...below];
};

const matchesFrom = <T>(
  sides: Comparing<T>,
  lengths: ReadonlyArray<Row>,
  [row, column]: Match,
): ReadonlyArray<Match> => {
  const item = sides.base[row];
  const other = sides.head[column];
  if (item === undefined || other === undefined) return [];
  if (sides.same(item, other))
    return [[row, column], ...matchesFrom(sides, lengths, [row + 1, column + 1])];
  const down = lengths[row + 1]?.[column] ?? 0;
  const right = lengths[row]?.[column + 1] ?? 0;
  return matchesFrom(sides, lengths, down >= right ? [row + 1, column] : [row, column + 1]);
};

type Walked<T> = { readonly runs: ReadonlyArray<AlignedRun<T>>; readonly from: Match };

const MOST_MATCHED = 400;

const runsOfMiddle = <T>(sides: Comparing<T>): ReadonlyArray<AlignedRun<T>> => {
  const { base, head } = sides;
  if (base.length + head.length > MOST_MATCHED) return [{ base, head }];
  const matches = matchesFrom(sides, lengthsFrom(sides, 0), [0, 0]);
  const { runs, from } = matches.reduce<Walked<T>>(
    (walked, [row, column]) => ({
      runs: [
        ...walked.runs,
        { base: base.slice(walked.from[0], row), head: head.slice(walked.from[1], column) },
        ...head.slice(column, column + 1).map(kept => ({ kept })),
      ],
      from: [row + 1, column + 1],
    }),
    { runs: [], from: [0, 0] },
  );
  return [...runs, { base: base.slice(from[0]), head: head.slice(from[1]) }];
};

const sharedLength = <T>({ base, head, same }: Comparing<T>): number => {
  const differs = base.findIndex((item, index) => {
    const other = head[index];
    return other === undefined || !same(item, other);
  });
  return differs === -1 ? base.length : differs;
};

export const aligned = <T>({ base, head, same }: Comparing<T>): ReadonlyArray<AlignedRun<T>> => {
  const start = sharedLength({ base, head, same });
  const end = sharedLength({
    base: base.slice(start).toReversed(),
    head: head.slice(start).toReversed(),
    same,
  });
  const kept = (item: T) => ({ kept: item });
  return [
    ...head.slice(0, start).map(kept),
    ...runsOfMiddle({
      base: base.slice(start, base.length - end),
      head: head.slice(start, head.length - end),
      same,
    }),
    ...head.slice(head.length - end).map(kept),
  ];
};
