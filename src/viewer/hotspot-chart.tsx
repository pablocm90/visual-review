import { type HotspotMove, hotspotMoves } from '../core/hotspot-moves.ts';
import type { Hotspot } from '../core/metric-findings.ts';
import type { PageData } from '../core/page.ts';

const commits = (count: number) => `${count} ${count === 1 ? 'commit' : 'commits'}`;

const nameOf = ({ node, base, head }: HotspotMove) =>
  base === undefined
    ? `${node.label}: ${node.state === 'added' ? 'new' : 'base not measured'}, ${commits(head.churn)}, cyclomatic ${head.cyclomatic}`
    : `${node.label}: ${base.churn} → ${commits(head.churn)}, cyclomatic ${base.cyclomatic} → ${head.cyclomatic}`;

const CORNER_LINES: Readonly<
  Record<NonNullable<HotspotMove['corner']>, (head: Hotspot) => string>
> = {
  enters: head => ` enters the corner: ${commits(head.churn)}, cyclomatic ${head.cyclomatic}.`,
  stays: () => ' was already there and changed again.',
};

const CornerLine = ({ move: { node, head, corner } }: { readonly move: HotspotMove }) =>
  corner && (
    <li>
      <code className="hotspot-move-node">{node.label}</code>
      {CORNER_LINES[corner](head)}
    </li>
  );

const PLOT = { left: 40, right: 300, top: 40, bottom: 280 };

const MIDDLE = (PLOT.left + PLOT.right) / 2;

type Place = (point: Hotspot) => { readonly x: number; readonly y: number };

type Scale = { readonly most: Hotspot; readonly place: Place };

const scaleOf = (moves: ReadonlyArray<HotspotMove>, cut: Hotspot, threshold: number): Scale => {
  const points = moves.flatMap(({ base, head }) => (base ? [base, head] : [head]));
  const most = {
    churn: Math.max(2 * cut.churn, ...points.map(({ churn }) => churn)),
    cyclomatic: Math.max(
      2 * cut.cyclomatic,
      threshold + 2,
      ...points.map(({ cyclomatic }) => cyclomatic),
    ),
  };
  return {
    most,
    place: point => ({
      x: PLOT.left + (PLOT.right - PLOT.left) * Math.sqrt(point.churn / most.churn),
      y: PLOT.bottom - (PLOT.bottom - PLOT.top) * Math.sqrt(point.cyclomatic / most.cyclomatic),
    }),
  };
};

type FrameProps = {
  readonly scale: Scale;
  readonly cut: Hotspot;
  readonly threshold: number;
  readonly churnDays: number;
};

const Frame = ({ scale: { most, place }, cut, threshold, churnDays }: FrameProps) => {
  const corner = place(cut);
  const line = place({ churn: 0, cyclomatic: threshold }).y;
  return (
    <>
      <rect
        className="hotspot-corner"
        x={corner.x}
        y={PLOT.top}
        width={PLOT.right - corner.x}
        height={corner.y - PLOT.top}
      />
      <text className="hotspot-note" x={PLOT.right - 6} y={PLOT.top + 14} textAnchor="end">
        complex, often changed
      </text>
      <path
        className="hotspot-axes"
        d={`M${PLOT.left} ${PLOT.top} V${PLOT.bottom} H${PLOT.right}`}
      />
      <path className="hotspot-threshold" d={`M${PLOT.left} ${line} H${PLOT.right}`} />
      <text className="hotspot-note" x={PLOT.left + 4} y={line - 5}>
        {`threshold ${threshold}`}
      </text>
      <text className="hotspot-tick" x={PLOT.left - 4} y={PLOT.bottom + 4} textAnchor="end">
        0
      </text>
      <text className="hotspot-tick" x={PLOT.left - 4} y={PLOT.top + 4} textAnchor="end">
        {most.cyclomatic}
      </text>
      <text className="hotspot-tick" x={PLOT.left} y={PLOT.bottom + 16}>
        0
      </text>
      <text className="hotspot-tick" x={PLOT.right} y={PLOT.bottom + 16} textAnchor="end">
        {most.churn}
      </text>
      <text className="hotspot-note" x={MIDDLE} y={306} textAnchor="middle">
        {`commits in ${churnDays} days`}
      </text>
      <text
        className="hotspot-note"
        x={12}
        y={(PLOT.top + PLOT.bottom) / 2}
        textAnchor="middle"
        transform={`rotate(-90 12 ${(PLOT.top + PLOT.bottom) / 2})`}
      >
        cyclomatic
      </text>
    </>
  );
};

const Point = ({ move, place }: { readonly move: HotspotMove; readonly place: Place }) => {
  const head = place(move.head);
  const base = move.base && place(move.base);
  return (
    <g role="img" aria-label={nameOf(move)}>
      {base && <line className="hotspot-path" x1={base.x} y1={base.y} x2={head.x} y2={head.y} />}
      {base && <circle className="hotspot-base" cx={base.x} cy={base.y} r={4} />}
      <circle className="hotspot-head" cx={head.x} cy={head.y} r={4.5} />
      {move.corner && (
        <text
          className="hotspot-label"
          x={head.x + (head.x > MIDDLE ? -8 : 8)}
          y={head.y - 6}
          textAnchor={head.x > MIDDLE ? 'end' : 'start'}
        >
          {move.node.label}
        </text>
      )}
    </g>
  );
};

export const HotspotChart = ({ review }: { readonly review: PageData }) => {
  const moves = hotspotMoves(review);
  const { thresholds, churnDays } = review;
  const scale = scaleOf(moves, thresholds.hotspot, thresholds.cyclomatic);
  return (
    <section className="metric-panel hotspot-chart">
      <h2 className="hotspot-title">Hotspots</h2>
      <p className="hotspot-caption">
        Churn against cyclomatic. Each changed node moves from its base (ring) to its head (dot).
      </p>
      <svg className="hotspot-plot" viewBox="0 0 320 310" role="group" aria-label="Hotspots">
        <Frame
          scale={scale}
          cut={thresholds.hotspot}
          threshold={thresholds.cyclomatic}
          churnDays={churnDays}
        />
        {moves.map(move => (
          <Point key={move.node.id} move={move} place={scale.place} />
        ))}
      </svg>
      <ol className="hotspot-moves" aria-label="Hotspot moves">
        {moves.map(move => (
          <CornerLine key={move.node.id} move={move} />
        ))}
      </ol>
    </section>
  );
};
