import {
  createContext,
  type ReactNode,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { anchorKey } from '../core/anchors.ts';
import type { DiffedNode, FilePatch } from '../core/diff-graphs.ts';
import { counted } from '../core/findings.ts';
import type { LogicLine } from '../core/logic-diff.ts';
import { holdsFewChanges, logicTotalsOf, runsOf } from '../core/logic-strip.ts';
import type { PageData } from '../core/page.ts';
import type { PreviousComment } from '../core/previous-comments.ts';
import type { SymbolFile } from '../core/read-range.ts';
import type { Comment } from '../core/review.ts';
import { testAnchorsIn } from '../core/since-review.ts';
import { isQuiet, qualified, SYMBOL_GROUPS, type SymbolStatement } from '../core/symbol-changes.ts';
import { type AnchoredSymbol, anchoredSymbols, decisionsOf } from '../core/symbol-findings.ts';
import { boxesAboveIn } from '../core/visible-diff.ts';
import { ChangedSinceTag, sinceLabel, useIsChangedSince } from './changed-since.tsx';
import type { Comments } from './comment-field.tsx';
import { highlightPatch, type PatchLine } from './highlight-patch.ts';
import { LogicLegend, LogicStrip } from './logic-strip.tsx';
import { RowNote, RowNotes } from './note-block.tsx';
import { PatchRows, useSaidAt } from './patch-rows.tsx';
import { CommentOn, SaidBefore, useHasSaid } from './said-before.tsx';
import { scrollInPanel } from './scroll-in-panel.ts';
import { Signature } from './signature-lines.tsx';
import {
  type Block,
  blockAround,
  decisionAt,
  holdsDecision,
  logicDiffHoldsSignature,
  otherEndOf,
  sameBlock,
} from './symbol-diff.ts';
import { type SymbolEnd, SymbolLines } from './symbol-lines.tsx';

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
  readonly patches: ReadonlyArray<FilePatch>;
  readonly allFiles: ReadonlyArray<SymbolFile>;
  readonly onGoTo: (id: string) => void;
  readonly onShowLine: (at: LineAt) => void;
  readonly onShowRow: (row: string) => void;
  readonly comments: Comments;
  readonly onComment: ((comment: Comment) => void) | undefined;
};

export type RowLanding = { readonly row?: string };

const RowLanded = createContext<string | undefined>(undefined);

export const useRowMarks = () => {
  const landed = useContext(RowLanded);
  return (anchor: Pick<PreviousComment['anchor'], 'kind' | 'id'>) =>
    landed === anchorKey(anchor) ? ({ 'aria-current': true, tabIndex: -1 } as const) : {};
};

type HeldRows = Pick<PageData, 'symbols' | 'tests'>;

export const holdsRow = (
  { symbols, tests }: HeldRows,
  { kind, id }: PreviousComment['anchor'],
): boolean =>
  kind === 'test'
    ? testAnchorsIn(tests).some(test => test.id === id)
    : symbols
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

export const MARKS: Readonly<Record<LogicLine['change'], string>> = {
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

export const logicLabel = (line: LogicLine, nodes: Places['nodes']): string => {
  const label = `${line.change} ${line.kind}: ${textOf(line)}`;
  return line.movedTo === undefined
    ? label
    : `${label}, moved to ${line.movedTo}${fileMovedTo(line, nodes)}`;
};

type ShowLine = (at: Omit<LineAt, 'node'>) => void;

type LogicPlaces = Pick<Places, 'nodes' | 'comments' | 'onComment'>;

type DecisionRow = ReturnType<typeof decisionsOf>[number] & {
  readonly marked: boolean;
  readonly label: string;
};

const LogicRow = ({
  row: { line, id, text, marked, label },
  onShowLine,
  nodes,
  comments,
  onComment,
}: LogicPlaces & { readonly row: DecisionRow; readonly onShowLine: ShowLine }) => {
  const marksOf = useRowMarks();
  return (
    <li
      className={`logic-row logic-${line.change}`}
      aria-label={label}
      data-comment-anchor={anchorKey({ kind: 'decision', id })}
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
      <RowNote
        anchor={{ kind: 'decision', id, text }}
        name={logicLabel(line, nodes)}
        comments={comments}
      />
      <SaidBefore on={{ kind: 'decision', id }} />
      {onComment && (
        <CommentOn
          className="logic-comment-on"
          name={logicLabel(line, nodes)}
          anchor={{ kind: 'decision', id, text }}
          comments={comments}
          onComment={onComment}
        />
      )}
    </li>
  );
};

type Shown = { readonly rows: ReadonlyArray<DecisionRow>; readonly block: Block | undefined };

/** Consecutive changed rows sitting in one block of the patch share it, shown once below them. */
const sharingBlocks = (
  rows: ReadonlyArray<DecisionRow>,
  lines: ReadonlyArray<PatchLine>,
): ReadonlyArray<Shown> => {
  const shown: Array<Shown> = [];
  for (const row of rows) {
    const block = blockAround(lines, decisionAt(row.line));
    const last = shown.at(-1);
    if (last?.block && block && sameBlock(last.block, block)) {
      shown[shown.length - 1] = {
        rows: [...last.rows, row],
        block: {
          from: Math.min(last.block.from, block.from),
          to: Math.max(last.block.to, block.to),
        },
      };
    } else shown.push({ rows: [row], block });
  }
  return shown;
};

const tagsOf = (
  { rows, block }: Shown,
  lines: ReadonlyArray<PatchLine>,
): ReadonlyArray<string | undefined> =>
  block === undefined
    ? []
    : lines.slice(block.from, block.to + 1).map(patchLine => {
        const tags = rows
          .filter(({ line }) => holdsDecision(line, patchLine))
          .map(({ line }) => `${MARKS[line.change]} ${line.kind}`);
        return tags.length === 0 ? undefined : tags.join(' ');
      });

type DiffUnder = {
  readonly patch: FilePatch;
  readonly lines: ReadonlyArray<PatchLine>;
  readonly saidAt: ReturnType<typeof useSaidAt>;
};

const LogicDiff = ({
  shown,
  under,
  name,
  ...commenting
}: LogicPlaces & {
  readonly shown: Shown;
  readonly under: DiffUnder;
  readonly name: string;
}) =>
  shown.block && (
    <li className="logic-diff changes" aria-label={`Diff under ${name}`}>
      <PatchRows
        path={under.patch.path}
        lines={under.lines.slice(shown.block.from, shown.block.to + 1)}
        tags={tagsOf(shown, under.lines)}
        saidAt={under.saidAt}
        landedRow={undefined}
        landed={undefined}
        {...commenting}
      />
    </li>
  );

const useDiffUnder = (patch: FilePatch | undefined): DiffUnder | undefined => {
  const lines = useMemo(() => (patch ? highlightPatch(patch) : []), [patch]);
  const saidAt = useSaidAt(patch?.path ?? '', lines);
  return patch && { patch, lines, saidAt };
};

const LogicLines = ({
  symbol,
  under,
  onShowLine,
  onShowRow,
  fewChanges,
  ...places
}: LogicPlaces & {
  readonly symbol: AnchoredSymbol;
  readonly under: DiffUnder | undefined;
  readonly onShowLine: ShowLine;
  readonly onShowRow: Places['onShowRow'];
  readonly fewChanges: boolean;
}) => {
  const isChangedSince = useIsChangedSince();
  const hasSaid = useHasSaid();
  const marksOf = useRowMarks();
  const { notes } = useContext(RowNotes);
  const name = `${symbol.item.kind} ${qualified(symbol.item)}`;
  const rows = decisionsOf(symbol).map(decision => {
    const marked = isChangedSince('decisions', decision.id);
    return {
      ...decision,
      marked,
      label: sinceLabel(logicLabel(decision.line, places.nodes), marked),
    };
  });
  const holdsNews = ({ id, marked }: DecisionRow): boolean =>
    marked ||
    places.comments[anchorKey({ kind: 'decision', id })] !== undefined ||
    notes[anchorKey({ kind: 'decision', id })] !== undefined ||
    hasSaid({ kind: 'decision', id });
  const rowOf = (row: DecisionRow) => (
    <LogicRow key={row.id} row={row} onShowLine={onShowLine} {...places} />
  );
  return (
    <details
      className="logic-rows"
      aria-label={`Rows of ${name}`}
      open={fewChanges || rows.some(holdsNews)}
    >
      <summary>
        <LogicStrip
          name={name}
          rows={rows}
          marksOf={id => marksOf({ kind: 'decision', id })}
          onTick={id => onShowRow(anchorKey({ kind: 'decision', id }))}
        />
      </summary>
      <ul className="logic-lines" aria-label={`Logic of ${name}`}>
        {runsOf(rows).flatMap(run =>
          run.unchanged
            ? [
                <li key={run.rows[0]?.id} className="logic-run">
                  <details
                    aria-label={`${run.rows.length} unchanged`}
                    open={run.rows.some(holdsNews)}
                  >
                    <summary>
                      ⋯ {run.rows.length} unchanged<span className="logic-run-show">, show</span>
                    </summary>
                    <ul>{run.rows.map(rowOf)}</ul>
                  </details>
                </li>,
              ]
            : under === undefined
              ? run.rows.map(rowOf)
              : sharingBlocks(run.rows, under.lines).flatMap((shown, at) => [
                  ...shown.rows.map(rowOf),
                  <LogicDiff
                    key={`diff ${shown.rows[0]?.id ?? at}`}
                    shown={shown}
                    under={under}
                    name={shown.rows.map(row => row.label).join(', ')}
                    {...places}
                  />,
                ]),
        )}
      </ul>
    </details>
  );
};

const useSymbolHoldsNews = () => {
  const isChangedSince = useIsChangedSince();
  const hasSaid = useHasSaid();
  const { notes } = useContext(RowNotes);
  return (symbol: AnchoredSymbol): boolean =>
    isChangedSince('symbols', symbol.id) ||
    hasSaid({ kind: 'symbol', id: symbol.id }) ||
    notes[anchorKey({ kind: 'symbol', id: symbol.id })] !== undefined ||
    decisionsOf(symbol).some(({ id }) => notes[anchorKey({ kind: 'decision', id })] !== undefined);
};

const useHasSymbolNews = () => {
  const holdsNews = useSymbolHoldsNews();
  return (file: SymbolFile): boolean =>
    'unreadable' in file ||
    changedSymbolCount([file]) > 0 ||
    anchoredSymbols(file.node, file.symbols).some(holdsNews);
};

type InItsFile = {
  readonly node: string;
  readonly patch: FilePatch | undefined;
  readonly inFile: ReadonlyArray<SymbolStatement>;
};

const patchOfNode = ({ nodes, patches }: Places, node: string): FilePatch | undefined => {
  const path = nodes.find(({ id }) => id === node)?.path;
  return patches.find(patch => patch.path === path);
};

const endsOf = (
  symbol: SymbolStatement,
  { node, patch, inFile }: InItsFile,
  places: Places,
): ReadonlyArray<SymbolEnd> => {
  const own = patch ? [{ patch, lines: symbol.lines, inFile }] : [];
  const other = otherEndOf({ symbol, node, files: places.allFiles });
  const otherPatch = other && patchOfNode(places, other.node);
  if (!other || !otherPatch) return own;
  const theirs = { patch: otherPatch, lines: other.lines, inFile: other.inFile };
  return symbol.movedTo === undefined ? [theirs, ...own] : [...own, theirs];
};

const SymbolName = ({ symbol }: { readonly symbol: SymbolStatement }) => {
  const mark = exportMarkOf(symbol);
  return (
    <>
      <span className="kind">{symbol.kind}</span> <code>{qualified(symbol)}</code>
      {mark !== undefined && <span className="export-mark"> {mark}</span>}
    </>
  );
};

const SymbolRow = ({
  anchored: { item: symbol, id },
  node,
  patch,
  inFile,
  ...places
}: Places & InItsFile & { readonly anchored: AnchoredSymbol }) => {
  const isChangedSince = useIsChangedSince();
  const marksOf = useRowMarks();
  const [diffOpen, setDiffOpen] = useState(false);
  const under = useDiffUnder(symbol.logic === undefined ? undefined : patch);
  const signatureInDiff = under !== undefined && logicDiffHoldsSignature(under.lines, symbol);
  const name = `${symbol.kind} ${qualified(symbol)}`;
  const ends = isQuiet(symbol) ? [] : endsOf(symbol, { node, patch, inFile }, places);
  return (
    <li
      className={symbol.logic === undefined ? 'symbol-row' : 'symbol-row symbol-with-logic'}
      aria-label={sinceLabel(`${nameOf(symbol)}: ${symbol.change}`, isChangedSince('symbols', id))}
      {...marksOf({ kind: 'symbol', id })}
    >
      <div className="symbol-head">
        <SymbolName symbol={symbol} />
        <ChangedSinceTag marked={isChangedSince('symbols', id)} />
        <Origin symbol={symbol} {...places} />
        {ends.length > 0 && (
          <button
            type="button"
            className="symbol-diff"
            aria-label={`Diff of ${name}`}
            aria-expanded={diffOpen}
            onClick={() => setDiffOpen(!diffOpen)}
          >
            {symbol.logic === undefined ? 'Diff' : 'Whole function'}
          </button>
        )}
      </div>
      {symbol.signature && !signatureInDiff && (
        <Signature name={name} signature={symbol.signature} />
      )}
      <RowNote anchor={{ kind: 'symbol', id }} name={name} comments={places.comments} />
      <SaidBefore on={{ kind: 'symbol', id }} />
      {places.onComment && (
        <CommentOn
          name={name}
          anchor={{ kind: 'symbol', id }}
          comments={places.comments}
          onComment={places.onComment}
        />
      )}
      {symbol.logic !== undefined && (
        <LogicLines
          symbol={{ item: symbol, id }}
          under={under}
          onShowLine={at => places.onShowLine({ node, ...at })}
          onShowRow={places.onShowRow}
          fewChanges={holdsFewChanges(inFile)}
          nodes={places.nodes}
          comments={places.comments}
          onComment={places.onComment}
        />
      )}
      {diffOpen && (
        <SymbolLines
          ends={ends}
          nodes={places.nodes}
          comments={places.comments}
          onComment={places.onComment}
        />
      )}
    </li>
  );
};

const SymbolList = ({
  title,
  symbols,
  ...row
}: Places &
  InItsFile & {
    readonly title: string;
    readonly symbols: ReadonlyArray<AnchoredSymbol>;
  }) => (
  <ul aria-label={title}>
    {symbols.map(anchored => (
      <SymbolRow key={anchored.id} anchored={anchored} {...row} />
    ))}
  </ul>
);

const SymbolFiles = ({ file, ...places }: Places & { readonly file: SymbolFile }) => {
  const inFile = 'symbols' in file ? file.symbols : [];
  const symbols = anchoredSymbols(file.node, inFile);
  const quiet = symbols.filter(({ item }) => isQuiet(item));
  const inItsFile = { node: file.node, patch: patchOfNode(places, file.node), inFile };
  const holdsNews = useSymbolHoldsNews();
  return (
    <>
      {'unreadable' in file && (
        <p className="unreadable">Its symbols couldn't be read: {file.unreadable}</p>
      )}
      {SYMBOL_GROUPS.flatMap(([title, holds]) => {
        const grouped = symbols.filter(({ item }) => holds(item));
        return grouped.length === 0
          ? []
          : [
              <section key={title} className="symbol-group">
                <h4>{title}</h4>
                <SymbolList title={title} symbols={grouped} {...inItsFile} {...places} />
              </section>,
            ];
      })}
      {quiet.length > 0 && (
        <details
          className="symbol-group"
          aria-label="Unchanged symbols"
          open={quiet.some(
            symbol =>
              places.comments[anchorKey({ kind: 'symbol', id: symbol.id })] !== undefined ||
              holdsNews(symbol),
          )}
        >
          <summary>{quiet.length} unchanged</summary>
          <SymbolList title="Unchanged" symbols={quiet} {...inItsFile} {...places} />
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

const openFoldsAround = (element: Element | null | undefined): void => {
  const fold = element?.closest('details');
  if (!fold) return;
  fold.open = true;
  openFoldsAround(fold.parentElement);
};

export const LandedRows = ({
  landing,
  children,
}: {
  readonly landing: RowLanding | undefined;
  readonly children: ReactNode;
}) => {
  const rows = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (landing?.row === undefined) return;
    const row = rows.current?.querySelector<HTMLElement>('li[aria-current]');
    if (!row) return;
    openFoldsAround(row);
    scrollInPanel(row, 'center');
    row.focus({ preventScroll: true });
  }, [landing]);
  return (
    <div ref={rows}>
      <RowLanded.Provider value={landing?.row}>{children}</RowLanded.Provider>
    </div>
  );
};

const LogicSummary = ({ files }: { readonly files: ReadonlyArray<SymbolFile> }) => {
  const { functions, decisions, exits } = logicTotalsOf(files);
  if (decisions === 0) return null;
  const deciding = counted(functions, 'function decides', 'functions decide');
  const exitWords = exits > 0 ? `, ${counted(exits, 'exit', 'exits')}` : '';
  return (
    <span className="logic-summary">
      {` · ${deciding} differently, ${counted(decisions, 'decision', 'decisions')}${exitWords}`}
    </span>
  );
};

export const WhatChanged = ({
  node,
  files,
  ...places
}: Places & {
  readonly node: DiffedNode;
  readonly files: ReadonlyArray<SymbolFile>;
}) => {
  const count = changedSymbolCount(files);
  const [keyOpen, setKeyOpen] = useState(false);
  const withLogic = symbolsIn(files).some(({ logic }) => logic !== undefined);
  return (
    <section className="column-section symbols" aria-label="What changed">
      <div className="what-changed-head">
        <h3>
          What changed{count > 0 && ` ${count}`}
          <LogicSummary files={files} />
        </h3>
        {withLogic && (
          <button
            type="button"
            className="logic-key"
            aria-expanded={keyOpen}
            onClick={() => setKeyOpen(!keyOpen)}
          >
            Key
          </button>
        )}
      </div>
      {withLogic && keyOpen && <LogicLegend />}
      <SymbolsOf node={node} files={files} {...places} />
    </section>
  );
};
