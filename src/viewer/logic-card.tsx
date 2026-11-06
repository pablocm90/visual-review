import type { DiffedNode } from '../core/diff-graphs.ts';
import type { LogicLine } from '../core/logic-diff.ts';
import { countsOf } from '../core/logic-strip.ts';
import type { SymbolFile } from '../core/read-range.ts';
import { qualified } from '../core/symbol-changes.ts';
import { anchoredSymbols, decisionsOf } from '../core/symbol-findings.ts';
import { exitsWords, type StripRow } from './logic-strip.tsx';
import { logicLabel } from './what-changed.tsx';

const PADDING_X = 14;
const PADDING_Y = 8;
const HEADER_HEIGHT = 26;
const ROW_HEIGHT = 32;
const TICK_PITCH = 8;
const GAP = 8;
const FILE_CHAR = 8;
const ROW_CHAR = 7;

type CardRow = {
  readonly id: string;
  readonly name: string;
  readonly shownName: string;
  readonly count: string;
  readonly decisions: ReadonlyArray<StripRow>;
};

export type LogicCard = {
  readonly count: string;
  readonly nameWidth: number;
  readonly rows: ReadonlyArray<CardRow>;
  readonly width: number;
  readonly height: number;
};

const countWords = (logic: ReadonlyArray<LogicLine>): string => {
  const { changed } = countsOf(logic);
  return `${changed} of ${logic.length}`;
};

const longest = (lengths: ReadonlyArray<number>): number => Math.max(0, ...lengths);

const cardOf = (node: DiffedNode | undefined, rows: ReadonlyArray<CardRow>): LogicCard => {
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
  const former = node?.formerLabel === undefined ? '' : ` was ${node.formerLabel}`;
  const fileWidth = `${node?.label ?? ''}${former}`.length * FILE_CHAR;
  return {
    count,
    nameWidth,
    rows,
    width: 2 * PADDING_X + Math.max(rowWidth, fileWidth + GAP + count.length * ROW_CHAR),
    height: 2 * PADDING_Y + HEADER_HEIGHT + rows.length * ROW_HEIGHT,
  };
};

export const logicCardsOf = ({
  files,
  nodes,
}: {
  readonly files: ReadonlyArray<SymbolFile>;
  readonly nodes: ReadonlyArray<DiffedNode>;
}): ReadonlyMap<string, LogicCard> =>
  new Map(
    files.flatMap(file => {
      if (!('symbols' in file)) return [];
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
              },
            ];
      });
      return [
        [
          file.node,
          cardOf(
            nodes.find(({ id }) => id === file.node),
            rows,
          ),
        ] as const,
      ];
    }),
  );

const Tick = ({ decision }: { readonly decision: StripRow }) => (
  <g role="button" tabIndex={-1} aria-label={decision.label}>
    <title>{decision.label}</title>
  </g>
);

const Row = ({
  row: { name, shownName, count, decisions },
  index,
  nameWidth,
}: {
  readonly row: CardRow;
  readonly index: number;
  readonly nameWidth: number;
}) => {
  const stripX = nameWidth + GAP;
  return (
    <g
      role="group"
      aria-label={`Marks of ${name}`}
      transform={`translate(${PADDING_X} ${PADDING_Y + HEADER_HEIGHT + index * ROW_HEIGHT})`}
    >
      <text className="card-name" y={ROW_HEIGHT / 2}>
        {shownName}
      </text>
      {decisions.map(decision => (
        <Tick key={decision.id} decision={decision} />
      ))}
      <text
        className="card-count"
        x={stripX + decisions.length * TICK_PITCH + GAP}
        y={ROW_HEIGHT / 2}
      >
        {count}
      </text>
    </g>
  );
};

export const LogicCardBody = ({
  card,
  label,
  formerLabel,
  width,
}: {
  readonly card: LogicCard;
  readonly label: string;
  readonly formerLabel: string | undefined;
  readonly width: number;
}) => {
  const middle = PADDING_Y + HEADER_HEIGHT / 2;
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
      <text className="card-total" x={width - PADDING_X} y={middle}>
        {card.count}
      </text>
      {card.rows.map((row, index) => (
        <Row key={row.id} row={row} index={index} nameWidth={card.nameWidth} />
      ))}
    </>
  );
};
