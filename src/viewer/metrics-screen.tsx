import { useState } from 'react';
import type { DiffedNode } from '../core/diff-graphs.ts';
import type { MetricFinding } from '../core/metric-findings.ts';
import {
  type MeasuredLeaf,
  measuredLeaves,
  type SortKey,
  sortedLeaves,
} from '../core/metric-rows.ts';
import { metricTotals } from '../core/metric-totals.ts';
import type { NodeMeasures } from '../core/metrics.ts';
import type { PageData } from '../core/page.ts';
import { LevelMark, signed, tenths } from './finding-display.tsx';
import { HotspotChart } from './hotspot-chart.tsx';

const SORTS: ReadonlyArray<readonly [SortKey, string]> = [
  ['cyclomatic', 'Cyclomatic Δ'],
  ['churn', 'Churn'],
  ['lines', 'Lines Δ'],
  ['abc', 'ABC Δ'],
];

type Column = {
  readonly name: string;
  readonly of: Measure;
  readonly finding?: MetricFinding['metric'];
  readonly meaning: (churnDays: number) => string;
};

const COLUMNS: ReadonlyArray<Column> = [
  {
    name: 'Lines',
    of: side => ('lines' in side ? side.lines : undefined),
    finding: 'lines',
    meaning: () => 'non-blank, non-comment lines in the file',
  },
  {
    name: 'Cyclomatic',
    of: side => ('lines' in side ? side.cyclomatic.highest : undefined),
    finding: 'cyclomatic',
    meaning: () => 'paths through its most branching function: 1 + one per branch',
  },
  {
    name: 'ABC',
    of: side => ('lines' in side ? side.abc : undefined),
    finding: 'abc',
    meaning: () => "the whole file's size in assignments, branches (calls) and conditions",
  },
  {
    name: 'Fan-out',
    of: side => side.fanOut,
    meaning: () => 'how many nodes it depends on in the graph',
  },
  { name: 'Fan-in', of: side => side.fanIn, meaning: () => 'how many nodes depend on it' },
  {
    name: 'Churn',
    of: side => side.churn,
    finding: 'hotspot',
    meaning: churnDays =>
      `commits touching its file in the ${churnDays} days before each side; its mark is a hotspot, past both the churn and the cyclomatic cuts`,
  },
];

const Legend = ({ churnDays }: { readonly churnDays: number }) => (
  <dl className="metric-legend">
    {COLUMNS.map(({ name, meaning }) => (
      <div key={name} className="metric-legend-entry">
        <dt className="metric-legend-term">{name}</dt>
        <dd className="metric-legend-meaning">{meaning(churnDays)}</dd>
      </div>
    ))}
    <div className="metric-legend-entry">
      <dt className="metric-legend-term">
        <LevelMark level="look" />
      </dt>
      <dd className="metric-legend-meaning">
        over a threshold: new, newly over, or grown (a hotspot: entering the corner, or its
        cyclomatic grew)
      </dd>
    </div>
    <div className="metric-legend-entry">
      <dt className="metric-legend-term">
        <LevelMark level="info" />
      </dt>
      <dd className="metric-legend-meaning">over on both sides and not grown</dd>
    </div>
  </dl>
);

const CHANGE_MARKS: Readonly<Partial<Record<DiffedNode['state'], string>>> = {
  added: '+',
  modified: '~',
  removed: '−',
};

const ChangeMark = ({ state }: { readonly state: DiffedNode['state'] }) => {
  const mark = CHANGE_MARKS[state];
  return (
    mark && (
      <span className="change-mark" role="img" aria-label={state}>
        {mark}
      </span>
    )
  );
};

type Measure = (side: NodeMeasures) => number | undefined;

const valueText = (value: number | undefined) => (value === undefined ? '—' : tenths(value));

type Sides = Pick<CellProps, 'base' | 'head'> & {
  readonly before: number | undefined;
  readonly after: number | undefined;
};

const caption = ({ base, head, before, after }: Sides) => {
  if (base === undefined) return 'new';
  if (head === undefined) return 'gone';
  return before !== undefined && after !== undefined && signed(after - before);
};

type CellProps = {
  readonly of: Measure;
  readonly base: NodeMeasures | undefined;
  readonly head: NodeMeasures | undefined;
  readonly finding: MetricFinding | undefined;
};

const Cell = ({ of, base, head, finding }: CellProps) => {
  const before = base && of(base);
  const after = head && of(head);
  return (
    <td className="metric-cell">
      {`${valueText(before)} → ${valueText(after)}`}
      <small className="metric-delta">{caption({ base, head, before, after })}</small>
      {finding && <LevelMark level={finding.level} />}
    </td>
  );
};

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
    <h3 className="metric-tile-name">{name}</h3>
    <p className="metric-tile-value">{value}</p>
    {caption && <p className="metric-tile-caption">{caption}</p>}
  </div>
);

const Totals = ({ review }: { readonly review: PageData }) => {
  const { lines, over, hotspots } = metricTotals(review);
  const { thresholds, churnDays } = review;
  return (
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
  );
};

type LeafTableProps = {
  readonly leaves: ReadonlyArray<MeasuredLeaf>;
  readonly findings: ReadonlyArray<MetricFinding>;
  readonly churnDays: number;
  readonly labelOf: (stack: string) => string;
  readonly onGoTo: (id: string) => void;
};

const LeafTable = ({ leaves, findings, churnDays, labelOf, onGoTo }: LeafTableProps) => {
  const [hop, setHop] = useState(false);
  const [picked, setPicked] = useState('');
  const [by, setBy] = useState<SortKey>('cyclomatic');
  const changed = leaves.filter(({ node }) => node.state !== 'unchanged');
  const nodesShown = hop ? leaves : changed;
  const stacks = [...new Set(nodesShown.map(({ stack }) => stack))];
  const inStack = stacks.includes(picked) ? picked : '';
  const shown = sortedLeaves({ leaves: nodesShown, by }).filter(
    ({ stack }) => inStack === '' || stack === inStack,
  );
  return (
    <>
      <div className="metric-controls">
        <div className="segmented" role="group" aria-label="Nodes shown">
          <button
            type="button"
            className="segmented-button"
            aria-pressed={!hop}
            onClick={() => setHop(false)}
          >
            {`Changed ${changed.length}`}
          </button>
          <button
            type="button"
            className="segmented-button"
            aria-pressed={hop}
            onClick={() => setHop(true)}
          >
            {`Changed + 1 hop ${leaves.length}`}
          </button>
        </div>
        <label className="metric-pick">
          Stack
          <select
            className="metric-select"
            value={inStack}
            onChange={event => setPicked(event.target.value)}
          >
            <option value="">All stacks</option>
            {stacks.map(stack => (
              <option key={stack} value={stack}>
                {labelOf(stack)}
              </option>
            ))}
          </select>
        </label>
        <label className="metric-pick">
          Sort by
          <select
            className="metric-select"
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
      </div>
      <section className="metric-panel metric-table-panel" aria-label="Metrics per node">
        <table className="metric-table">
          <caption className="metric-table-caption">Base → head, the Δ under it.</caption>
          <thead>
            <tr>
              <th scope="col">Node</th>
              {COLUMNS.map(({ name }) => (
                <th key={name} scope="col">
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map(({ node, stack, base, head }) => (
              <tr key={node.id}>
                <th scope="row" className="metric-node" data-state={node.state}>
                  <ChangeMark state={node.state} />
                  <button
                    type="button"
                    className="metric-node-name"
                    onClick={() => onGoTo(node.id)}
                  >
                    {node.label}
                  </button>
                  <span className="metric-node-stack">{labelOf(stack)}</span>
                </th>
                {COLUMNS.map(({ name, of, finding }) => (
                  <Cell
                    key={name}
                    of={of}
                    base={base}
                    head={head}
                    finding={findings.find(
                      ({ node: at, metric }) => at === node.id && metric === finding,
                    )}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <Legend churnDays={churnDays} />
      </section>
    </>
  );
};

type MetricsScreenProps = {
  readonly review: PageData;
  readonly onGoTo: (id: string) => void;
};

export const MetricsScreen = ({ review, onGoTo }: MetricsScreenProps) => {
  const leaves = measuredLeaves(review);
  return (
    <div className="metrics-screen">
      <Totals review={review} />
      {leaves.length === 0 ? (
        <p className="metric-empty">No node measured.</p>
      ) : (
        <>
          <LeafTable
            leaves={leaves}
            findings={review.metricFindings}
            churnDays={review.churnDays}
            labelOf={stack => review.diff.nodes.find(({ id }) => id === stack)?.label ?? stack}
            onGoTo={onGoTo}
          />
          <HotspotChart review={review} />
        </>
      )}
    </div>
  );
};
