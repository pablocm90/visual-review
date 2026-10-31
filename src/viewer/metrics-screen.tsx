import { metricTotals } from '../core/metric-totals.ts';
import type { PageData } from '../core/page.ts';
import { signed } from './finding-display.tsx';

const Tile = ({
  name,
  value,
  caption,
}: {
  readonly name: string;
  readonly value: string;
  readonly caption: string | undefined;
}) => (
  <div className="metric-tile" role="group" aria-label={name}>
    <h3>{name}</h3>
    <p className="metric-tile-value">{value}</p>
    {caption && <p className="metric-tile-caption">{caption}</p>}
  </div>
);

export const MetricsScreen = ({ review }: { readonly review: PageData }) => {
  const { lines, over, hotspots } = metricTotals(review);
  const { thresholds, churnDays } = review;
  return (
    <div className="metrics-screen">
      <section className="metric-totals" aria-label="Totals">
        <Tile
          name="Lines"
          value={signed(lines.by)}
          caption={`across ${lines.across} changed ${lines.across === 1 ? 'node' : 'nodes'}`}
        />
        <Tile
          name={`Functions over ${thresholds.cyclomatic} cyclomatic`}
          value={`${over.base} → ${over.head}`}
          caption={over.highest && `${over.highest.name} at ${over.highest.cyclomatic}`}
        />
        <Tile
          name="Hotspots touched"
          value={`${hotspots.touched} of ${hotspots.of}`}
          caption={`${thresholds.hotspot.churn}+ commits in ${churnDays} days and ${thresholds.hotspot.cyclomatic}+ cyclomatic`}
        />
      </section>
    </div>
  );
};
