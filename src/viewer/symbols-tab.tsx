import type { DiffedNode } from '../core/diff-graphs.ts';
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

type Places = {
  readonly nodes: ReadonlyArray<DiffedNode>;
  readonly onGoTo: (id: string) => void;
};

const Moved = ({
  words,
  id,
  nodes,
  onGoTo,
}: Places & { readonly words: string; readonly id: string }) => (
  <span className="origin">
    {' '}
    {words}{' '}
    <button type="button" className="go-to" onClick={() => onGoTo(id)}>
      {nodes.find(node => node.id === id)?.label}
    </button>
  </span>
);

const SymbolList = ({
  title,
  symbols,
  ...places
}: Places & {
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
        {symbol.movedTo !== undefined && <Moved words="moved to" id={symbol.movedTo} {...places} />}
        {symbol.movedFrom !== undefined && (
          <Moved words="moved from" id={symbol.movedFrom} {...places} />
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

export const SymbolFiles = ({
  files,
  ...places
}: Places & { readonly files: ReadonlyArray<SymbolFile> }) => {
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
                <SymbolList title={title} symbols={grouped} {...places} />
              </section>,
            ];
      })}
      {quiet.length > 0 && (
        <details className="symbol-group">
          <summary>{quiet.length} unchanged</summary>
          <SymbolList title="Unchanged" symbols={quiet} {...places} />
        </details>
      )}
    </>
  );
};
