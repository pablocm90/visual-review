import { useMemo } from 'react';
import type { FilePatch } from '../core/diff-graphs.ts';
import type { SymbolStatement } from '../core/symbol-changes.ts';
import { highlightPatch } from './highlight-patch.ts';
import { type LineComments, PatchRows, useSaidAt } from './patch-rows.tsx';
import { holdsFirstLine, rowsOfSymbol } from './symbol-diff.ts';

type LinesProps = LineComments & {
  readonly patch: FilePatch;
  readonly lines: SymbolStatement['lines'];
  readonly inFile: ReadonlyArray<SymbolStatement>;
};

const LinesOfFile = ({ patch: { path, patch }, lines, inFile, ...commenting }: LinesProps) => {
  const rows = useMemo(
    () => rowsOfSymbol({ rows: highlightPatch({ path, patch }), lines, inFile }),
    [path, patch, lines, inFile],
  );
  const saidAt = useSaidAt(path, rows);
  if (rows.length === 0)
    return (
      <p role="note" className="symbol-lines-note">
        No line of its own changed.
      </p>
    );
  return (
    <div className="changes symbol-lines">
      {!holdsFirstLine({ rows, lines }) && (
        <p role="note" className="symbol-lines-note">
          Only its changed lines.
        </p>
      )}
      <PatchRows
        path={path}
        lines={rows}
        saidAt={saidAt}
        landedRow={undefined}
        landed={undefined}
        {...commenting}
      />
    </div>
  );
};

export type SymbolEnd = Pick<LinesProps, 'patch' | 'lines' | 'inFile'>;

export const SymbolLines = ({
  ends,
  ...commenting
}: LineComments & { readonly ends: ReadonlyArray<SymbolEnd> }) =>
  ends.map(end =>
    ends.length === 1 ? (
      <LinesOfFile key={end.patch.path} {...end} {...commenting} />
    ) : (
      <section
        key={end.patch.path}
        className="symbol-lines-end"
        aria-label={`Lines in ${end.patch.path}`}
      >
        <h5>{end.patch.path}</h5>
        <LinesOfFile {...end} {...commenting} />
      </section>
    ),
  );
