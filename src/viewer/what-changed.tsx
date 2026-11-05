import { createContext, useContext, useLayoutEffect, useRef } from 'react';
import { anchorKey } from '../core/anchors.ts';
import type { DiffedNode } from '../core/diff-graphs.ts';
import type { LogicLine } from '../core/logic-diff.ts';
import type { SymbolFile } from '../core/read-range.ts';
import type { Comment } from '../core/review.ts';
import {
  changesApi,
  isQuiet,
  qualified,
  type SymbolChange,
  type SymbolStatement,
} from '../core/symbol-changes.ts';
import { type AnchoredSymbol, anchoredSymbols, decisionsOf } from '../core/symbol-findings.ts';
import { boxesAboveIn } from '../core/visible-diff.ts';
import { ChangedSinceTag, sinceLabel, useIsChangedSince } from './changed-since.tsx';
import type { Comments } from './comment-field.tsx';
import { CommentOn, SaidBefore, useHasSaid } from './said-before.tsx';
import { scrollInPanel } from './scroll-in-panel.ts';
import { Signature } from './signature-lines.tsx';

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

const changedSymbolCount = (files: ReadonlyArray<SymbolFile>): number =>
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

export type RowLanding = { readonly row?: string };

const RowLanded = createContext<string | undefined>(undefined);

const useRowMarks = () => {
  const landed = useContext(RowLanded);
  return (anchor: Pick<Comment['anchor'], 'kind' | 'id'>) =>
    landed === anchorKey(anchor) ? ({ 'aria-current': true, tabIndex: -1 } as const) : {};
};

export const holdsRow = (
  files: ReadonlyArray<SymbolFile>,
  { kind, id }: Comment['anchor'],
): boolean =>
  files
    .flatMap(file => ('symbols' in file ? anchoredSymbols(file.node, file.symbols) : []))
    .some(symbol =>
      kind === 'symbol'
        ? symbol.id === id
        : kind === 'decision' && decisionsOf(symbol).some(line => line.id === id),
    );

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
  moved: '→',
};

const textOf = ({ base, head }: LogicLine): string =>
  base !== undefined && head !== undefined ? `${base} → ${head}` : (head ?? base ?? '');

const fileMovedTo = ({ movedToNode }: LogicLine, nodes: Places['nodes']): string =>
  movedToNode === undefined ? '' : ` in ${labelOf(nodes, movedToNode) ?? movedToNode}`;

const LogicText = ({
  line,
  nodes,
}: {
  readonly line: LogicLine;
  readonly nodes: Places['nodes'];
}) => (
  <>
    <span className="mark">{MARKS[line.change]}</span> <span className="kind">{line.kind}</span>{' '}
    {line.change === 'changed' ? (
      <>
        <del>{line.base}</del> <ins>{line.head}</ins>
      </>
    ) : (
      <code>{line.head ?? line.base}</code>
    )}
    {line.movedTo !== undefined && (
      <span className="origin">
        {' '}
        moved to <code>{line.movedTo}</code>
        {fileMovedTo(line, nodes)}
      </span>
    )}
  </>
);

const logicLabel = (line: LogicLine, nodes: Places['nodes']): string => {
  const label = `${line.change} ${line.kind}: ${textOf(line)}`;
  return line.movedTo === undefined
    ? label
    : `${label}, moved to ${line.movedTo}${fileMovedTo(line, nodes)}`;
};

type ShowLine = (at: Omit<LineAt, 'node'>) => void;

const LogicLines = ({
  symbol,
  onShowLine,
  nodes,
  comments,
  onComment,
}: Pick<Places, 'nodes' | 'comments' | 'onComment'> & {
  readonly symbol: AnchoredSymbol;
  readonly onShowLine: ShowLine;
}) => {
  const isChangedSince = useIsChangedSince();
  const marksOf = useRowMarks();
  return (
    <ul
      className="logic-lines"
      aria-label={`Logic of ${symbol.item.kind} ${qualified(symbol.item)}`}
    >
      {decisionsOf(symbol).map(({ line, id, text }) => {
        const marked = isChangedSince('decisions', id);
        const label = sinceLabel(logicLabel(line, nodes), marked);
        return (
          <li
            key={id}
            className={`logic-${line.change}`}
            aria-label={label}
            {...marksOf({ kind: 'decision', id })}
            style={{ paddingInlineStart: `${line.depth}em` }}
          >
            {line.change === 'same' ? (
              <LogicText line={line} nodes={nodes} />
            ) : (
              <button
                type="button"
                className="logic-line"
                aria-label={label}
                onClick={() =>
                  onShowLine({ side: line.head === undefined ? 'base' : 'head', line: line.line })
                }
              >
                <LogicText line={line} nodes={nodes} />
              </button>
            )}
            <ChangedSinceTag marked={marked} />
            <SaidBefore on={{ kind: 'decision', id }} />
            {onComment && (
              <CommentOn
                name={logicLabel(line, nodes)}
                anchor={{ kind: 'decision', id, text }}
                comments={comments}
                onComment={onComment}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
};

const useHasSymbolNews = () => {
  const isChangedSince = useIsChangedSince();
  const hasSaid = useHasSaid();
  return (file: SymbolFile): boolean =>
    'unreadable' in file ||
    changedSymbolCount([file]) > 0 ||
    anchoredSymbols(file.node, file.symbols).some(
      ({ id }) => isChangedSince('symbols', id) || hasSaid({ kind: 'symbol', id }),
    );
};

const SymbolList = ({
  node,
  title,
  symbols,
  ...places
}: Places & {
  readonly node: string;
  readonly title: string;
  readonly symbols: ReadonlyArray<AnchoredSymbol>;
}) => {
  const isChangedSince = useIsChangedSince();
  const marksOf = useRowMarks();
  return (
    <ul aria-label={title}>
      {symbols.map(({ item: symbol, id }) => (
        <li
          key={id}
          aria-label={sinceLabel(
            `${nameOf(symbol)}: ${symbol.change}`,
            isChangedSince('symbols', id),
          )}
          {...marksOf({ kind: 'symbol', id })}
        >
          <span className="kind">{symbol.kind}</span> <code>{qualified(symbol)}</code>
          {exportMarkOf(symbol) !== undefined && (
            <span className="export-mark"> {exportMarkOf(symbol)}</span>
          )}
          <ChangedSinceTag marked={isChangedSince('symbols', id)} />
          <Origin symbol={symbol} {...places} />
          {symbol.signature && (
            <Signature name={`${symbol.kind} ${qualified(symbol)}`} signature={symbol.signature} />
          )}
          <SaidBefore on={{ kind: 'symbol', id }} />
          {places.onComment && (
            <CommentOn
              name={`${symbol.kind} ${qualified(symbol)}`}
              anchor={{ kind: 'symbol', id }}
              comments={places.comments}
              onComment={places.onComment}
            />
          )}
          {symbol.logic !== undefined && (
            <LogicLines
              symbol={{ item: symbol, id }}
              onShowLine={at => places.onShowLine({ node, ...at })}
              nodes={places.nodes}
              comments={places.comments}
              onComment={places.onComment}
            />
          )}
        </li>
      ))}
    </ul>
  );
};

const SymbolFiles = ({ file, ...places }: Places & { readonly file: SymbolFile }) => {
  const symbols = 'symbols' in file ? anchoredSymbols(file.node, file.symbols) : [];
  const quiet = symbols.filter(({ item }) => isQuiet(item));
  const isChangedSince = useIsChangedSince();
  const hasSaid = useHasSaid();
  return (
    <>
      {'unreadable' in file && (
        <p className="unreadable">Its symbols couldn't be read: {file.unreadable}</p>
      )}
      {GROUPS.flatMap(([title, holds]) => {
        const grouped = symbols.filter(({ item }) => holds(item));
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
        <details
          className="symbol-group"
          open={quiet.some(
            ({ id }) =>
              places.comments[anchorKey({ kind: 'symbol', id })] !== undefined ||
              isChangedSince('symbols', id) ||
              hasSaid({ kind: 'symbol', id }),
          )}
        >
          <summary>{quiet.length} unchanged</summary>
          <SymbolList node={file.node} title="Unchanged" symbols={quiet} {...places} />
        </details>
      )}
    </>
  );
};

const SymbolsOf = ({
  node,
  files,
  ...places
}: Places & { readonly node: DiffedNode; readonly files: ReadonlyArray<SymbolFile> }) => {
  const hasSymbolNews = useHasSymbolNews();
  return node.kind === 'file'
    ? files.map(file => <SymbolFiles key={file.node} file={file} {...places} />)
    : files.filter(hasSymbolNews).map(file => (
        <section
          key={file.node}
          className="symbol-file"
          aria-label={labelOf(places.nodes, file.node)}
        >
          <h4>{labelOf(places.nodes, file.node)}</h4>
          <SymbolFiles file={file} {...places} />
        </section>
      ));
};

export const useFilesWithNews = (
  node: DiffedNode | undefined,
  files: ReadonlyArray<SymbolFile>,
  nodes: ReadonlyArray<DiffedNode>,
): ReadonlyArray<SymbolFile> => {
  const hasSymbolNews = useHasSymbolNews();
  const boxesAbove = boxesAboveIn(nodes);
  const here = node
    ? files.filter(file => file.node === node.id || boxesAbove(file.node).includes(node.id))
    : [];
  return here.some(hasSymbolNews) ? here : [];
};

export const WhatChanged = ({
  node,
  files,
  landing,
  ...places
}: Places & {
  readonly node: DiffedNode;
  readonly files: ReadonlyArray<SymbolFile>;
  readonly landing: RowLanding | undefined;
}) => {
  const section = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (landing?.row === undefined) return;
    const row = section.current?.querySelector<HTMLElement>('[aria-current]');
    if (!row) return;
    const fold = row.closest('details');
    if (fold) fold.open = true;
    scrollInPanel(row, 'center');
    row.focus({ preventScroll: true });
  }, [landing]);
  const count = changedSymbolCount(files);
  return (
    <section ref={section} className="column-section symbols" aria-label="What changed">
      <h3>What changed{count > 0 && ` ${count}`}</h3>
      <RowLanded.Provider value={landing?.row}>
        <SymbolsOf node={node} files={files} {...places} />
      </RowLanded.Provider>
    </section>
  );
};
