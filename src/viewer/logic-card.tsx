import type { DiffedNode, FilePatch } from '../core/diff-graphs.ts';
import type { LogicLine } from '../core/logic-diff.ts';
import { countsOf, isExit } from '../core/logic-strip.ts';
import type { SymbolFile } from '../core/read-range.ts';
import { qualified } from '../core/symbol-changes.ts';
import { anchoredSymbols, decisionsOf } from '../core/symbol-findings.ts';
import { highlightPatch, type PatchLine } from './highlight-patch.ts';
import { exitsWords, type StripRow } from './logic-strip.tsx';
import { blockAround, decisionAt, holdsDecision, joinedBlocks } from './symbol-diff.ts';
import { logicLabel, MARKS } from './what-changed.tsx';

/** How much of each function a logic card shows: its marks, its changed decisions, or its code. */
export type CardDepth = 'ticks' | 'decisions' | 'code';

export const CARD_DEPTHS: ReadonlyArray<readonly [CardDepth, string]> = [
  ['ticks', 'Marks'],
  ['decisions', 'Decisions'],
  ['code', 'Code'],
];

const PADDING_X = 14;
const PADDING_Y = 8;
const HEADER_HEIGHT = 26;
const ROW_HEIGHT = 32;
const TICK_PITCH = 8;
const TICK_WIDTH = 6;
const TICK_AREA = 30;
const PLATE_MARGIN = 2;
const GAP = 8;
const FILE_CHAR = 8;
const ROW_CHAR = 7;
const LINE_HEIGHT = 16;
const LINE_CHAR = 6.6;
const LONGEST_LINE = 72;
const TAG_WIDTH = 64;
const LINES_GAP = 6;
const OPEN_WIDTH = 44;

/** A line under a function on a card: a decision, or a row of its code. */
type CardLine = {
  readonly kind: 'added' | 'removed' | 'changed' | 'context' | 'gap';
  readonly text: string;
  readonly tag?: string;
  readonly decision?: string;
};

type CardRow = {
  readonly id: string;
  readonly name: string;
  readonly shownName: string;
  readonly count: string;
  readonly decisions: ReadonlyArray<StripRow>;
  readonly lines: ReadonlyArray<CardLine>;
};

export type LogicCard = {
  readonly count: string;
  readonly depth: CardDepth;
  readonly nameWidth: number;
  readonly rows: ReadonlyArray<CardRow>;
  readonly width: number;
  readonly height: number;
};

const shortened = (text: string): string =>
  text.length > LONGEST_LINE ? `${text.slice(0, LONGEST_LINE - 1)}…` : text;

const decisionLines = (decisions: ReadonlyArray<StripRow>): ReadonlyArray<CardLine> =>
  decisions.flatMap(({ id, line }): ReadonlyArray<CardLine> => {
    if (line.change === 'same') return [];
    const tag = `${MARKS[line.change]} ${line.kind}`;
    if (line.change === 'changed')
      return [
        { kind: 'removed', text: shortened(line.base ?? ''), tag, decision: id },
        { kind: 'added', text: shortened(line.head ?? ''), decision: id },
      ];
    const kind =
      line.change === 'removed' ? 'removed' : line.change === 'added' ? 'added' : 'changed';
    return [{ kind, text: shortened(line.head ?? line.base ?? ''), tag, decision: id }];
  });

const textOfRow = (row: PatchLine): string =>
  shortened(`${row.prefix}${row.pieces.map(piece => piece.text).join('')}`);

const ROW_KINDS: Readonly<Partial<Record<PatchLine['kind'], CardLine['kind']>>> = {
  added: 'added',
  removed: 'removed',
  context: 'context',
};

const codeLines = (
  decisions: ReadonlyArray<StripRow>,
  rows: ReadonlyArray<PatchLine>,
): ReadonlyArray<CardLine> => {
  const changed = decisions.filter(({ line }) => line.change !== 'same');
  const blocks = joinedBlocks(
    changed.flatMap(({ line }) => blockAround(rows, decisionAt(line)) ?? []),
  );
  if (blocks.length === 0) return decisionLines(decisions);
  return blocks.flatMap(
    (block, index): ReadonlyArray<CardLine> => [
      ...(index > 0 ? [{ kind: 'gap', text: '⋯' } as const] : []),
      ...rows.slice(block.from, block.to + 1).map((row): CardLine => {
        const on = changed.filter(({ line }) => holdsDecision(line, row));
        const tag = on.map(({ line }) => `${MARKS[line.change]} ${line.kind}`).join(' ');
        return {
          kind: ROW_KINDS[row.kind] ?? 'context',
          text: textOfRow(row),
          ...(tag !== '' && { tag }),
          ...(on[0] && { decision: on[0].id }),
        };
      }),
    ],
  );
};

const countWords = (logic: ReadonlyArray<LogicLine>): string => {
  const { changed } = countsOf(logic);
  return `${changed} of ${logic.length}`;
};

const longest = (lengths: ReadonlyArray<number>): number => Math.max(0, ...lengths);

const linesHeight = (lines: ReadonlyArray<CardLine>): number =>
  lines.length === 0 ? 0 : lines.length * LINE_HEIGHT + LINES_GAP;

const rowHeight = (row: CardRow): number => ROW_HEIGHT + linesHeight(row.lines);

const cardOf = (
  node: DiffedNode | undefined,
  rows: ReadonlyArray<CardRow>,
  depth: CardDepth,
): LogicCard => {
  const { changed, exits } = countsOf(
    rows.flatMap(({ decisions }) => decisions.map(({ line }) => line)),
  );
  const count = `${changed}${exitsWords(exits)}`;
  const nameWidth = longest(rows.map(({ shownName }) => shownName.length)) * ROW_CHAR;
  const rowWidth = longest(
    rows.map(
      row =>
        nameWidth + GAP + row.decisions.length * TICK_PITCH + GAP + row.count.length * ROW_CHAR,
    ),
  );
  const linesWidth = longest(
    rows.flatMap(row => row.lines.map(line => TAG_WIDTH + line.text.length * LINE_CHAR)),
  );
  const former = node?.formerLabel === undefined ? '' : ` was ${node.formerLabel}`;
  const fileWidth = `${node?.label ?? ''}${former}`.length * FILE_CHAR;
  return {
    count,
    depth,
    nameWidth,
    rows,
    width:
      2 * PADDING_X +
      Math.max(rowWidth, linesWidth, fileWidth + GAP + count.length * ROW_CHAR + OPEN_WIDTH),
    height: 2 * PADDING_Y + HEADER_HEIGHT + rows.reduce((sum, row) => sum + rowHeight(row), 0),
  };
};

const depthOf = (depth: CardDepth, opened: ReadonlySet<string>, node: string): CardDepth =>
  opened.has(node) ? 'code' : depth;

export const logicCardsOf = ({
  files,
  nodes,
  patches = [],
  depth = 'ticks',
  opened = new Set(),
}: {
  readonly files: ReadonlyArray<SymbolFile>;
  readonly nodes: ReadonlyArray<DiffedNode>;
  readonly patches?: ReadonlyArray<FilePatch>;
  readonly depth?: CardDepth;
  readonly opened?: ReadonlySet<string>;
}): ReadonlyMap<string, LogicCard> =>
  new Map(
    files.flatMap(file => {
      if (!('symbols' in file)) return [];
      const shown = depthOf(depth, opened, file.node);
      const path = nodes.find(({ id }) => id === file.node)?.path;
      const patch = patches.find(each => each.path === path);
      const patchRows = shown === 'code' && patch ? highlightPatch(patch) : [];
      const linesOf = (decisions: ReadonlyArray<StripRow>): ReadonlyArray<CardLine> => {
        if (shown === 'ticks') return [];
        return shown === 'code' ? codeLines(decisions, patchRows) : decisionLines(decisions);
      };
      const rows = anchoredSymbols(file.node, file.symbols).flatMap(symbol => {
        const decisions = decisionsOf(symbol).map(({ id, line }) => ({
          id,
          line,
          label: logicLabel(line, nodes),
        }));
        const logic = decisions.map(({ line }) => line);
        return countsOf(logic).changed === 0
          ? []
          : [
              {
                id: symbol.id,
                name: `${symbol.item.kind} ${qualified(symbol.item)}`,
                shownName: qualified(symbol.item),
                count: countWords(logic),
                decisions,
                lines: linesOf(decisions),
              },
            ];
      });
      return [
        [
          file.node,
          cardOf(
            nodes.find(({ id }) => id === file.node),
            rows,
            shown,
          ),
        ] as const,
      ];
    }),
  );

const markOf = (line: LogicLine): { readonly y: number; readonly height: number } => {
  if (line.change === 'same') return { y: 14, height: 2 };
  if (line.change === 'removed') return { y: 15, height: isExit(line) ? 14 : 8 };
  return isExit(line) ? { y: 1, height: 14 } : { y: 7, height: 8 };
};

const boxPath = (x: number, y: number, width: number, height: number): string =>
  `M${x} ${y}h${width}v${height}h${-width}z`;

type OnTick = ((decision: string) => void) | undefined;

const Tick = ({
  decision,
  x,
  onTick,
}: {
  readonly decision: StripRow;
  readonly x: number;
  readonly onTick: OnTick;
}) => {
  const { y, height } = markOf(decision.line);
  return (
    <g
      className="card-tick"
      role="button"
      tabIndex={-1}
      aria-label={decision.label}
      transform={`translate(${x} ${(ROW_HEIGHT - TICK_AREA) / 2})`}
      {...(onTick && { onClick: () => onTick(decision.id) })}
    >
      <title>{decision.label}</title>
      <path className="card-tick-hit" d={boxPath(-1, 0, TICK_PITCH, TICK_AREA)} />
      <path
        className={`card-mark card-mark-${decision.line.change}`}
        d={boxPath(0, y, TICK_WIDTH, height)}
      />
    </g>
  );
};

const CardLines = ({
  lines,
  width,
  onTick,
}: {
  readonly lines: ReadonlyArray<CardLine>;
  readonly width: number;
  readonly onTick: OnTick;
}) => (
  <g className="card-lines" transform={`translate(0 ${ROW_HEIGHT})`}>
    {lines.map((line, index) => {
      const { decision } = line;
      const go = decision !== undefined && onTick ? { onClick: () => onTick(decision) } : {};
      return (
        <g
          // biome-ignore lint/suspicious/noArrayIndexKey: a card's lines are fixed and may repeat
          key={index}
          className={`card-line card-line-${line.kind}${decision === undefined ? '' : ' card-line-goes'}`}
          transform={`translate(0 ${index * LINE_HEIGHT})`}
          {...go}
        >
          <path className="card-line-plate" d={boxPath(-4, 0, width + 8, LINE_HEIGHT)} />
          {line.tag !== undefined && (
            <text className="card-line-tag" x={TAG_WIDTH - 8} y={LINE_HEIGHT / 2}>
              {line.tag}
            </text>
          )}
          <text className="card-line-text" x={TAG_WIDTH} y={LINE_HEIGHT / 2}>
            {line.text}
          </text>
        </g>
      );
    })}
  </g>
);

const Row = ({
  row: { name, shownName, count, decisions, lines },
  top,
  nameWidth,
  width,
  onTick,
}: {
  readonly row: CardRow;
  readonly top: number;
  readonly nameWidth: number;
  readonly width: number;
  readonly onTick: OnTick;
}) => {
  const stripX = nameWidth + GAP;
  return (
    <g
      role="group"
      aria-label={`Marks of ${name}`}
      transform={`translate(${PADDING_X} ${PADDING_Y + HEADER_HEIGHT + top})`}
    >
      <text className="card-name" y={ROW_HEIGHT / 2}>
        {shownName}
      </text>
      <path
        className="card-strip-plate"
        d={boxPath(
          stripX - PLATE_MARGIN,
          (ROW_HEIGHT - TICK_AREA) / 2,
          decisions.length * TICK_PITCH + PLATE_MARGIN,
          TICK_AREA,
        )}
      />
      {decisions.map((decision, tick) => (
        <Tick
          key={decision.id}
          decision={decision}
          x={stripX + tick * TICK_PITCH}
          onTick={onTick}
        />
      ))}
      <text
        className="card-count"
        x={stripX + decisions.length * TICK_PITCH + GAP}
        y={ROW_HEIGHT / 2}
      >
        {count}
      </text>
      {lines.length > 0 && <CardLines lines={lines} width={width} onTick={onTick} />}
    </g>
  );
};

const topsOf = (rows: ReadonlyArray<CardRow>): ReadonlyArray<number> =>
  rows.map((_, index) => rows.slice(0, index).reduce((sum, row) => sum + rowHeight(row), 0));

export const LogicCardBody = ({
  card,
  label,
  formerLabel,
  width,
  onTick,
  onOpen,
  opened,
}: {
  readonly card: LogicCard;
  readonly label: string;
  readonly formerLabel: string | undefined;
  readonly width: number;
  readonly onTick: OnTick;
  readonly onOpen: (() => void) | undefined;
  readonly opened: boolean;
}) => {
  const middle = PADDING_Y + HEADER_HEIGHT / 2;
  const tops = topsOf(card.rows);
  return (
    <>
      <text className="card-file" x={PADDING_X} y={middle}>
        {label}
        {formerLabel !== undefined && (
          <tspan className="former" dx={GAP}>
            was {formerLabel}
          </tspan>
        )}
      </text>
      <text className="card-total" x={width - PADDING_X - OPEN_WIDTH} y={middle}>
        {card.count}
      </text>
      {onOpen && (
        <g
          className="card-open"
          role="button"
          tabIndex={-1}
          aria-label={`Code of ${label}`}
          aria-pressed={opened}
          onClick={event => {
            event.stopPropagation();
            onOpen();
          }}
          transform={`translate(${width - PADDING_X - OPEN_WIDTH + GAP} ${PADDING_Y + 3})`}
        >
          <path
            className="card-open-plate"
            d={boxPath(0, 0, OPEN_WIDTH - GAP, HEADER_HEIGHT - 8)}
          />
          <text className="card-open-word" x={(OPEN_WIDTH - GAP) / 2} y={(HEADER_HEIGHT - 8) / 2}>
            {opened ? 'less' : 'code'}
          </text>
        </g>
      )}
      {card.rows.map((row, index) => (
        <Row
          key={row.id}
          row={row}
          top={tops[index] ?? 0}
          nameWidth={card.nameWidth}
          width={width - 2 * PADDING_X}
          onTick={onTick}
        />
      ))}
    </>
  );
};
