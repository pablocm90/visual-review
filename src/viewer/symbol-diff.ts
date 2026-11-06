import type { SymbolStatement } from '../core/symbol-changes.ts';
import type { PatchLine } from './highlight-patch.ts';

type Spans = SymbolStatement['lines'];

const within = (line: number | undefined, range: Spans['base']): boolean =>
  line !== undefined && range !== undefined && range.start <= line && line <= range.end;

const isChange = ({ kind }: PatchLine): boolean => kind === 'added' || kind === 'removed';

export const rowsOfSymbol = ({
  rows,
  lines,
}: {
  readonly rows: ReadonlyArray<PatchLine>;
  readonly lines: Spans;
}): ReadonlyArray<PatchLine> => {
  const holds = (row: PatchLine | undefined): boolean =>
    within(row?.base, lines.base) || within(row?.head, lines.head);
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
