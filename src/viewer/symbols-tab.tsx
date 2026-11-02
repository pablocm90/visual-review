import type { SymbolFile } from '../core/read-range.ts';
import {
  changesApi,
  qualified,
  type SymbolChange,
  type SymbolStatement,
} from '../core/symbol-changes.ts';

type Group = readonly [string, (symbol: SymbolStatement) => boolean];

const ofChange =
  (change: SymbolChange) =>
  (symbol: SymbolStatement): boolean =>
    !changesApi(symbol) && symbol.change === change;

const GROUPS: ReadonlyArray<Group> = [
  ['API', changesApi],
  ['Edited', ofChange('edited')],
  ['Renamed', ofChange('renamed')],
  ['Moved', ofChange('moved')],
  ['Added', ofChange('added')],
  ['Removed', ofChange('removed')],
];

const symbolsIn = (files: ReadonlyArray<SymbolFile>): ReadonlyArray<SymbolStatement> =>
  files.flatMap(file => ('symbols' in file ? file.symbols : []));

export const changedSymbolCount = (files: ReadonlyArray<SymbolFile>): number =>
  symbolsIn(files).filter(symbol => GROUPS.some(([, holds]) => holds(symbol))).length;

export const SymbolFiles = ({ files }: { readonly files: ReadonlyArray<SymbolFile> }) =>
  GROUPS.flatMap(([title, holds]) => {
    const grouped = symbolsIn(files).filter(holds);
    return grouped.length === 0
      ? []
      : [
          <section key={title} className="symbol-group">
            <h4>{title}</h4>
            <ul aria-label={title}>
              {grouped.map(symbol => (
                <li
                  key={`${symbol.kind} ${qualified(symbol)}`}
                  aria-label={`${symbol.kind} ${qualified(symbol)}: ${symbol.change}`}
                >
                  <span className="kind">{symbol.kind}</span> <code>{qualified(symbol)}</code>
                </li>
              ))}
            </ul>
          </section>,
        ];
  });
