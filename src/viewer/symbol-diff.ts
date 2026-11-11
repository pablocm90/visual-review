import type { SymbolFile } from '../core/read-range.ts';
import type { SymbolStatement } from '../core/symbol-changes.ts';
import type { PatchLine } from './highlight-patch.ts';

type Spans = SymbolStatement['lines'];

export const otherEndOf = ({
  symbol: { movedTo, movedFrom, name, scope, kind },
  node,
  files,
}: {
  readonly symbol: SymbolStatement;
  readonly node: string;
  readonly files: ReadonlyArray<SymbolFile>;
}) => {
  const other = movedTo ?? movedFrom;
  const file = files.find(candidate => candidate.node === other);
  if (other === undefined || file === undefined || !('symbols' in file)) return undefined;
  const end = file.symbols.find(
    candidate =>
      candidate.name === name &&
      candidate.scope === scope &&
      candidate.kind === kind &&
      (candidate.movedTo === node || candidate.movedFrom === node),
  );
  return end && { node: other, lines: end.lines, inFile: file.symbols };
};

const within = (line: number | undefined, range: Spans['base']): boolean =>
  line !== undefined && range !== undefined && range.start <= line && line <= range.end;

const isInside = (inner: Spans['base'], outer: Spans['base']): boolean =>
  inner !== undefined &&
  outer !== undefined &&
  outer.start <= inner.start &&
  inner.end <= outer.end &&
  inner.end - inner.start < outer.end - outer.start;

const isChange = ({ kind }: PatchLine): boolean => kind === 'added' || kind === 'removed';

const startsAt = (line: number | undefined, range: Spans['base']): boolean =>
  line !== undefined && line === range?.start;

export const holdsFirstLine = ({
  rows,
  lines: { base, head },
}: {
  readonly rows: ReadonlyArray<PatchLine>;
  readonly lines: Spans;
}): boolean => rows.some(row => startsAt(row.base, base) || startsAt(row.head, head));

const headerOf = (rows: ReadonlyArray<PatchLine>): PatchLine => {
  const base = rows.find(row => row.base !== undefined)?.base;
  const head = rows.find(row => row.head !== undefined)?.head;
  const sides = [base === undefined ? [] : [`-${base}`], head === undefined ? [] : [`+${head}`]];
  const text = `@@ ${sides.flat().join(' ')} @@`;
  return { kind: 'header', prefix: '', pieces: [{ text, scopes: [] }] };
};

export const rowsOfSymbol = ({
  rows,
  lines,
  inFile,
}: {
  readonly rows: ReadonlyArray<PatchLine>;
  readonly lines: Spans;
  readonly inFile: ReadonlyArray<Pick<SymbolStatement, 'lines'>>;
}): ReadonlyArray<PatchLine> => {
  const insideIt = inFile
    .map(symbol => symbol.lines)
    .filter(({ base, head }) => isInside(base, lines.base) || isInside(head, lines.head));
  const isIn = (row: PatchLine | undefined, { base, head }: Spans): boolean =>
    within(row?.base, base) || within(row?.head, head);
  const holds = (row: PatchLine | undefined): boolean =>
    isIn(row, lines) && !insideIt.some(spans => isIn(row, spans));
  const starts = rows.flatMap((row, index) => (row.kind === 'header' ? [index] : []));
  return starts.flatMap((start, index) => {
    const hunk = rows.slice(start, starts[index + 1]);
    const kept = hunk.filter(
      (row, at) => holds(row) || (row.kind === 'note' && holds(hunk[at - 1])),
    );
    return kept.some(isChange) ? [headerOf(kept), ...kept] : [];
  });
};

export type DecisionAt = { readonly side: 'base' | 'head'; readonly line: number };

/** The rows a decision sits in: its run of added and removed rows, with one row either side. */
export type Block = { readonly from: number; readonly to: number };

export const blockAround = (
  rows: ReadonlyArray<PatchLine>,
  { side, line }: DecisionAt,
): Block | undefined => {
  const at = rows.findIndex(row => row.kind !== 'header' && row[side] === line);
  const row = rows[at];
  if (row === undefined) return undefined;
  if (!isChange(row)) return { from: at, to: at };
  const changed = (index: number) => {
    const each = rows[index];
    return each !== undefined && isChange(each);
  };
  const first = rows.findLastIndex((_, index) => index < at && !changed(index)) + 1;
  const after = rows.findIndex((_, index) => index > at && !changed(index));
  const last = (after === -1 ? rows.length : after) - 1;
  const context = (index: number) => {
    const row = rows[index];
    return row?.kind === 'context' && row.pieces.some(piece => piece.text.trim() !== '');
  };
  return { from: context(first - 1) ? first - 1 : first, to: context(last + 1) ? last + 1 : last };
};

export const sameBlock = (one: Block | undefined, other: Block | undefined): boolean =>
  one !== undefined && other !== undefined && one.from <= other.to && other.from <= one.to;

type Placed = { readonly change: string; readonly head?: string; readonly line: number };

/** Where a decision is read: its head line, or its base line when the head lost it. */
export const decisionAt = ({ head, line }: Placed): DecisionAt => ({
  side: head === undefined ? 'base' : 'head',
  line,
});

/** Whether a patch row holds the decision: its own row, or the row a changed one was. */
export const holdsDecision = (decision: Placed, row: PatchLine): boolean => {
  const { side, line } = decisionAt(decision);
  const own =
    row[side] === line &&
    (row.kind === 'context' || row.kind === (side === 'base' ? 'removed' : 'added'));
  return own || (decision.change === 'changed' && row.kind === 'removed' && row.base === line);
};

/** Joins blocks that overlap or touch, in order. */
export const joinedBlocks = (blocks: ReadonlyArray<Block>): ReadonlyArray<Block> =>
  blocks
    .toSorted((one, other) => one.from - other.from)
    .reduce<Array<Block>>((joined, block) => {
      const last = joined.at(-1);
      if (last && block.from <= last.to + 1)
        joined[joined.length - 1] = { ...last, to: Math.max(last.to, block.to) };
      else joined.push(block);
      return joined;
    }, []);

type Spanned = Pick<SymbolStatement, 'lines'> & {
  readonly logic?: ReadonlyArray<Placed> | undefined;
};

/** Whether the diff under a symbol's logic changes holds a changed row on its first line. */
export const logicDiffHoldsSignature = (
  rows: ReadonlyArray<PatchLine>,
  { lines, logic = [] }: Spanned,
): boolean =>
  logic
    .filter(line => line.change !== 'same')
    .flatMap(line => blockAround(rows, decisionAt(line)) ?? [])
    .some(({ from, to }) =>
      rows
        .slice(from, to + 1)
        .some(
          row =>
            (row.kind === 'added' && row.head === lines.head?.start) ||
            (row.kind === 'removed' && row.base === lines.base?.start),
        ),
    );
