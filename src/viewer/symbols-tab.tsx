import type { SymbolFile } from '../core/read-range.ts';
import { qualified, type SymbolChange, type SymbolStatement } from '../core/symbol-changes.ts';

const GROUPS: ReadonlyArray<readonly [SymbolChange, string]> = [
  ['edited', 'Edited'],
  ['renamed', 'Renamed'],
  ['moved', 'Moved'],
  ['added', 'Added'],
  ['removed', 'Removed'],
];

const symbolsIn = (files: ReadonlyArray<SymbolFile>): ReadonlyArray<SymbolStatement> =>
  files.flatMap(file => ('symbols' in file ? file.symbols : []));

export const changedSymbolCount = (files: ReadonlyArray<SymbolFile>): number =>
  symbolsIn(files).filter(({ change }) => GROUPS.some(([grouped]) => grouped === change)).length;

export const SymbolFiles = ({ files }: { readonly files: ReadonlyArray<SymbolFile> }) =>
  GROUPS.flatMap(([change, title]) => {
    const grouped = symbolsIn(files).filter(symbol => symbol.change === change);
    return grouped.length === 0
      ? []
      : [
          <section key={change} className="symbol-group">
            <h4>{title}</h4>
            <ul aria-label={title}>
              {grouped.map(symbol => (
                <li
                  key={`${symbol.kind} ${qualified(symbol)}`}
                  aria-label={`${symbol.kind} ${qualified(symbol)}: ${change}`}
                >
                  <span className="kind">{symbol.kind}</span> <code>{qualified(symbol)}</code>
                </li>
              ))}
            </ul>
          </section>,
        ];
  });
