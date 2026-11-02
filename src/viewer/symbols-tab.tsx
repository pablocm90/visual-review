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

const isQuiet = (symbol: SymbolStatement): boolean => !GROUPS.some(([, holds]) => holds(symbol));

export const changedSymbolCount = (files: ReadonlyArray<SymbolFile>): number =>
  symbolsIn(files).filter(symbol => !isQuiet(symbol)).length;

const SymbolList = ({
  title,
  symbols,
}: {
  readonly title: string;
  readonly symbols: ReadonlyArray<SymbolStatement>;
}) => (
  <ul aria-label={title}>
    {symbols.map(symbol => (
      <li
        key={`${symbol.kind} ${qualified(symbol)}`}
        aria-label={`${symbol.kind} ${qualified(symbol)}: ${symbol.change}`}
      >
        <span className="kind">{symbol.kind}</span> <code>{qualified(symbol)}</code>
        {symbol.renamedFrom !== undefined && (
          <span className="origin">
            {' '}
            {symbol.probably ? 'probably renamed from' : 'renamed from'}{' '}
            <code>{symbol.renamedFrom}</code>
          </span>
        )}
        {symbol.signature && (
          <span className="signature">
            <del>{symbol.signature.base}</del>
            <ins>{symbol.signature.head}</ins>
          </span>
        )}
      </li>
    ))}
  </ul>
);

export const SymbolFiles = ({ files }: { readonly files: ReadonlyArray<SymbolFile> }) => {
  const quiet = symbolsIn(files).filter(isQuiet);
  return (
    <>
      {GROUPS.flatMap(([title, holds]) => {
        const grouped = symbolsIn(files).filter(holds);
        return grouped.length === 0
          ? []
          : [
              <section key={title} className="symbol-group">
                <h4>{title}</h4>
                <SymbolList title={title} symbols={grouped} />
              </section>,
            ];
      })}
      {quiet.length > 0 && (
        <details className="symbol-group">
          <summary>{quiet.length} unchanged</summary>
          <SymbolList title="Unchanged" symbols={quiet} />
        </details>
      )}
    </>
  );
};
