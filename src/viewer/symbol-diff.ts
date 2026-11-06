import type { SymbolStatement } from '../core/symbol-changes.ts';
import type { PatchLine } from './highlight-patch.ts';

type Spans = SymbolStatement['lines'];

const within = (line: number | undefined, range: Spans['base']): boolean =>
  line !== undefined && range !== undefined && range.start <= line && line <= range.end;

const isInside = (inner: Spans['base'], outer: Spans['base']): boolean =>
  inner !== undefined &&
  outer !== undefined &&
  outer.start <= inner.start &&
  inner.end <= outer.end &&
  inner.end - inner.start < outer.end - outer.start;

const isChange = ({ kind }: PatchLine): boolean => kind === 'added' || kind === 'removed';

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
      (row, at) =>
        row.kind === 'header' || holds(row) || (row.kind === 'note' && holds(hunk[at - 1])),
    );
    return kept.some(isChange) ? kept : [];
  });
};
