import type { DiffedNode } from '../core/diff-graphs.ts';
import type { LogicLine } from '../core/logic-diff.ts';
import type { SymbolFile } from '../core/read-range.ts';
import type { Comment } from '../core/review.ts';
import {
  changesApi,
  qualified,
  type SymbolChange,
  type SymbolStatement,
} from '../core/symbol-changes.ts';
import { decisionsOf } from '../core/symbol-findings.ts';
import { CommentOn, type Comments } from './comment-field.tsx';

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

export type LineAt = {
  readonly node: string;
  readonly side: 'base' | 'head';
  readonly line: number;
};

type Places = {
  readonly nodes: ReadonlyArray<DiffedNode>;
  readonly onGoTo: (id: string) => void;
  readonly onShowLine: (at: LineAt) => void;
  readonly comments: Comments;
  readonly onComment: ((comment: Comment) => void) | undefined;
};

const labelOf = (nodes: ReadonlyArray<DiffedNode>, id: string): string | undefined =>
  nodes.find(node => node.id === id)?.label;

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
      {labelOf(nodes, id)}
    </button>
  </span>
);

const Origin = ({ symbol, ...places }: Places & { readonly symbol: SymbolStatement }) => (
  <>
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
  </>
);

const exportMarkOf = ({ exported }: SymbolStatement): string | undefined => {
  if (exported.base === true && exported.head === false) return 'no longer exported';
  if (exported.base === false && exported.head === true) return 'now exported';
  return (exported.head ?? exported.base) === true ? 'exported' : undefined;
};

const nameOf = (symbol: SymbolStatement): string => {
  const mark = exportMarkOf(symbol);
  const name = `${symbol.kind} ${qualified(symbol)}`;
  return mark === undefined ? name : `${name}, ${mark}`;
};

const MARKS: Readonly<Record<LogicLine['change'], string>> = {
  same: '·',
  added: '+',
  removed: '−',
  changed: '~',
};

const textOf = ({ base, head }: LogicLine): string =>
  base !== undefined && head !== undefined ? `${base} → ${head}` : (head ?? base ?? '');

const LogicText = ({ line }: { readonly line: LogicLine }) => (
  <>
    <span className="mark">{MARKS[line.change]}</span> <span className="kind">{line.kind}</span>{' '}
    {line.change === 'changed' ? (
      <>
        <del>{line.base}</del> <ins>{line.head}</ins>
      </>
    ) : (
      <code>{line.head ?? line.base}</code>
    )}
  </>
);

const logicLabel = (line: LogicLine): string => `${line.change} ${line.kind}: ${textOf(line)}`;

type ShowLine = (at: Omit<LineAt, 'node'>) => void;

const LogicLines = ({
  node,
  symbol,
  onShowLine,
  comments,
  onComment,
}: Pick<Places, 'comments' | 'onComment'> & {
  readonly node: string;
  readonly symbol: SymbolStatement;
  readonly onShowLine: ShowLine;
}) => (
  <ul className="logic-lines" aria-label={`Logic of ${symbol.kind} ${qualified(symbol)}`}>
    {decisionsOf(node, symbol).map(({ line, id, text }) => (
      <li
        key={id}
        className={`logic-${line.change}`}
        aria-label={logicLabel(line)}
        style={{ paddingInlineStart: `${line.depth}em` }}
      >
        {line.change === 'same' ? (
          <LogicText line={line} />
        ) : (
          <button
            type="button"
            className="logic-line"
            aria-label={logicLabel(line)}
            onClick={() =>
              onShowLine({ side: line.change === 'removed' ? 'base' : 'head', line: line.line })
            }
          >
            <LogicText line={line} />
          </button>
        )}
        {onComment && (
          <CommentOn
            name={logicLabel(line)}
            anchor={{ kind: 'decision', id, text }}
            comments={comments}
            onComment={onComment}
          />
        )}
      </li>
    ))}
  </ul>
);

export const hasSymbolNews = (file: SymbolFile): boolean =>
  'unreadable' in file || changedSymbolCount([file]) > 0;

const SymbolList = ({
  node,
  title,
  symbols,
  ...places
}: Places & {
  readonly node: string;
  readonly title: string;
  readonly symbols: ReadonlyArray<SymbolStatement>;
}) => (
  <ul aria-label={title}>
    {symbols.map(symbol => (
      <li
        key={`${symbol.kind} ${qualified(symbol)}`}
        aria-label={`${nameOf(symbol)}: ${symbol.change}`}
      >
        <span className="kind">{symbol.kind}</span> <code>{qualified(symbol)}</code>
        {exportMarkOf(symbol) !== undefined && (
          <span className="export-mark"> {exportMarkOf(symbol)}</span>
        )}
        <Origin symbol={symbol} {...places} />
        {symbol.signature && (
          <span className="signature">
            <del>{symbol.signature.base}</del>
            <ins>{symbol.signature.head}</ins>
          </span>
        )}
        {places.onComment && (
          <CommentOn
            name={`${symbol.kind} ${qualified(symbol)}`}
            anchor={{ kind: 'symbol', id: `${node}#${qualified(symbol)}` }}
            comments={places.comments}
            onComment={places.onComment}
          />
        )}
        {symbol.logic !== undefined && (
          <LogicLines
            node={node}
            symbol={symbol}
            onShowLine={at => places.onShowLine({ node, ...at })}
            comments={places.comments}
            onComment={places.onComment}
          />
        )}
      </li>
    ))}
  </ul>
);

const SymbolFiles = ({ file, ...places }: Places & { readonly file: SymbolFile }) => {
  const files = [file];
  const quiet = symbolsIn(files).filter(isQuiet);
  return (
    <>
      {'unreadable' in file && (
        <p className="unreadable">Its symbols couldn't be read: {file.unreadable}</p>
      )}
      {GROUPS.flatMap(([title, holds]) => {
        const grouped = symbolsIn(files).filter(holds);
        return grouped.length === 0
          ? []
          : [
              <section key={title} className="symbol-group">
                <h4>{title}</h4>
                <SymbolList node={file.node} title={title} symbols={grouped} {...places} />
              </section>,
            ];
      })}
      {quiet.length > 0 && (
        <details className="symbol-group">
          <summary>{quiet.length} unchanged</summary>
          <SymbolList node={file.node} title="Unchanged" symbols={quiet} {...places} />
        </details>
      )}
    </>
  );
};

export const SymbolsOf = ({
  node,
  files,
  ...places
}: Places & { readonly node: DiffedNode; readonly files: ReadonlyArray<SymbolFile> }) =>
  node.kind === 'file'
    ? files.map(file => <SymbolFiles key={file.node} file={file} {...places} />)
    : files.filter(hasSymbolNews).map(file => (
        <section
          key={file.node}
          className="symbol-file"
          aria-label={labelOf(places.nodes, file.node)}
        >
          <h3>{labelOf(places.nodes, file.node)}</h3>
          <SymbolFiles file={file} {...places} />
        </section>
      ));
