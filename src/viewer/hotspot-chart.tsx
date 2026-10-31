import { type HotspotMove, hotspotMoves } from '../core/hotspot-moves.ts';
import type { Hotspot } from '../core/metric-findings.ts';
import type { PageData } from '../core/page.ts';

const commits = (count: number) => `${count} ${count === 1 ? 'commit' : 'commits'}`;

const nameOf = ({ node, base, head }: HotspotMove) =>
  base === undefined
    ? `${node.label}: new, ${commits(head.churn)}, cyclomatic ${head.cyclomatic}`
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
      <code>{node.label}</code>
      {CORNER_LINES[corner](head)}
    </li>
  );

const PLOT = { left: 40, right: 300, top: 40, bottom: 280 };

type Place = (point: Hotspot) => { readonly x: number; readonly y: number };

const placeOf = (moves: ReadonlyArray<HotspotMove>, cut: Hotspot): Place => {
  const points = moves.flatMap(({ base, head }) => (base ? [base, head] : [head]));
  const most = (of: (point: Hotspot) => number) => Math.max(2 * of(cut), ...points.map(of));
  const churn = most(({ churn }) => churn);
  const cyclomatic = most(({ cyclomatic }) => cyclomatic);
  return point => ({
    x: PLOT.left + ((PLOT.right - PLOT.left) * point.churn) / churn,
    y: PLOT.bottom - ((PLOT.bottom - PLOT.top) * point.cyclomatic) / cyclomatic,
  });
};

const Point = ({ move, place }: { readonly move: HotspotMove; readonly place: Place }) => {
  const head = place(move.head);
  const base = move.base && place(move.base);
  return (
    <g role="img" aria-label={nameOf(move)}>
      {base && <line className="hotspot-path" x1={base.x} y1={base.y} x2={head.x} y2={head.y} />}
      {base && <circle className="hotspot-base" cx={base.x} cy={base.y} r={4} />}
      <circle className="hotspot-head" cx={head.x} cy={head.y} r={4.5} />
      <text x={head.x + 8} y={head.y - 6}>
        {move.node.label}
      </text>
    </g>
  );
};

export const HotspotChart = ({ review }: { readonly review: PageData }) => {
  const moves = hotspotMoves(review);
  const place = placeOf(moves, review.thresholds.hotspot);
  return (
    <section className="hotspot-chart">
      <h2>Hotspots</h2>
      <p>
        Churn against cyclomatic. Each changed node moves from its base (ring) to its head (dot).
      </p>
      <svg viewBox="0 0 320 310" role="group" aria-label="Hotspots">
        {moves.map(move => (
          <Point key={move.node.id} move={move} place={place} />
        ))}
      </svg>
      <ol aria-label="Hotspot moves">
        {moves.map(move => (
          <CornerLine key={move.node.id} move={move} />
        ))}
      </ol>
    </section>
  );
};
