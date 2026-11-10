export type PatchRowKind = 'header' | 'context' | 'added' | 'removed' | 'note';

export type PatchRow = {
  readonly kind: PatchRowKind;
  readonly prefix: string;
  readonly code: string;
  readonly base?: number;
  readonly head?: number;
};

export type Hunk = {
  readonly start: { readonly base: number; readonly head: number };
  readonly rows: ReadonlyArray<PatchRow>;
};

export type LineSide = 'base' | 'head';

const KIND_BY_PREFIX: Readonly<Record<string, PatchRowKind>> = {
  '@': 'header',
  '\\': 'note',
  '+': 'added',
  '-': 'removed',
};

const SIDE_KINDS: Readonly<Record<LineSide, ReadonlyArray<PatchRowKind>>> = {
  base: ['context', 'removed'],
  head: ['context', 'added'],
};

export const holdsSide = (kind: PatchRowKind, side: LineSide): boolean =>
  SIDE_KINDS[side].includes(kind);

const rowOf = (line: string): Omit<PatchRow, LineSide> => {
  const kind = KIND_BY_PREFIX[line.slice(0, 1)] ?? 'context';
  if (kind === 'header' || kind === 'note') return { kind, prefix: '', code: line };
  return { kind, prefix: line.slice(0, 1), code: line.slice(1) };
};

const startOf = (header: string): Hunk['start'] => {
  const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(header);
  return { base: Number(match?.[1]), head: Number(match?.[2]) };
};

type Numbering = {
  readonly rows: ReadonlyArray<PatchRow>;
  readonly at: Readonly<Record<LineSide, number>>;
};

const numbered = (rows: ReadonlyArray<Omit<PatchRow, LineSide>>, start: Hunk['start']) =>
  rows.reduce<Numbering>(
    ({ rows, at }, row) => ({
      rows: rows.concat({
        ...row,
        ...(holdsSide(row.kind, 'base') && { base: start.base + at.base }),
        ...(holdsSide(row.kind, 'head') && { head: start.head + at.head }),
      }),
      at: {
        base: at.base + Number(holdsSide(row.kind, 'base')),
        head: at.head + Number(holdsSide(row.kind, 'head')),
      },
    }),
    { rows: [], at: { base: 0, head: 0 } },
  ).rows;

export const patchHunks = (patch: string): ReadonlyArray<Hunk> => {
  const rows = patch.split('\n').map(rowOf);
  const starts = rows.flatMap((row, index) => (row.kind === 'header' ? [index] : []));
  return starts.map((first, index) => {
    const start = startOf(rows[first]?.code ?? '');
    return { start, rows: numbered(rows.slice(first, starts[index + 1]), start) };
  });
};

export const lineIdOf = (
  path: string,
  { kind, base, head }: Pick<PatchRow, 'kind' | LineSide>,
): string | undefined => {
  const side = kind === 'removed' ? 'base' : 'head';
  const number = { base, head }[side];
  return number === undefined ? undefined : `${path}@${side}:${number}`;
};
