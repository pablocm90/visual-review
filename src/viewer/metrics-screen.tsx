import { useState } from 'react';
import { measuredLeaves, type SortKey, sortedLeaves } from '../core/metric-rows.ts';
import { metricTotals } from '../core/metric-totals.ts';
import type { PageData } from '../core/page.ts';
import { signed } from './finding-display.tsx';

const SORTS: ReadonlyArray<readonly [SortKey, string]> = [
  ['cyclomatic', 'Cyclomatic Δ'],
  ['churn', 'Churn'],
  ['lines', 'Lines Δ'],
  ['abc', 'ABC Δ'],
];

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
  const [hop, setHop] = useState(false);
  const leaves = measuredLeaves(review);
  const changed = leaves.filter(({ node }) => node.state !== 'unchanged');
  const [picked, setPicked] = useState('');
  const [by, setBy] = useState<SortKey>('cyclomatic');
  const nodesShown = hop ? leaves : changed;
  const stacks = [...new Set(nodesShown.map(({ stack }) => stack))];
  const inStack = stacks.includes(picked) ? picked : '';
  const shown = sortedLeaves({ leaves: nodesShown, by }).filter(
    ({ stack }) => inStack === '' || stack === inStack,
  );
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
      <div role="group" aria-label="Nodes shown">
        <button type="button" aria-pressed={!hop} onClick={() => setHop(false)}>
          {`Changed ${changed.length}`}
        </button>
        <button type="button" aria-pressed={hop} onClick={() => setHop(true)}>
          {`Changed + 1 hop ${leaves.length}`}
        </button>
      </div>
      <label>
        Stack
        <select value={inStack} onChange={event => setPicked(event.target.value)}>
          <option value="">All stacks</option>
          {stacks.map(stack => (
            <option key={stack}>{stack}</option>
          ))}
        </select>
      </label>
      <label>
        Sort by
        <select
          value={by}
          onChange={event => {
            const sort = SORTS.find(([key]) => key === event.target.value);
            if (sort) setBy(sort[0]);
          }}
        >
          {SORTS.map(([key, name]) => (
            <option key={key} value={key}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <section aria-label="Metrics per node">
        <table>
          <tbody>
            {shown.map(({ node, stack }) => (
              <tr key={node.id}>
                <th scope="row">
                  <code>{node.label}</code>
                  <span>{stack}</span>
                </th>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
};
