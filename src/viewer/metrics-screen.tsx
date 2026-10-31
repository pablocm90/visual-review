import { useState } from 'react';
import type { DiffedNode } from '../core/diff-graphs.ts';
import type { MetricFinding } from '../core/metric-findings.ts';
import { measuredLeaves, type SortKey, sortedLeaves } from '../core/metric-rows.ts';
import { metricTotals } from '../core/metric-totals.ts';
import type { NodeMeasures } from '../core/metrics.ts';
import type { PageData } from '../core/page.ts';
import { LevelMark, signed, tenths } from './finding-display.tsx';

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
};

const COLUMNS: ReadonlyArray<Column> = [
  { name: 'Lines', of: side => ('lines' in side ? side.lines : undefined), finding: 'lines' },
  {
    name: 'Cyclomatic',
    of: side => ('lines' in side ? side.cyclomatic.highest : undefined),
    finding: 'cyclomatic',
  },
  { name: 'ABC', of: side => ('lines' in side ? side.abc : undefined), finding: 'abc' },
  { name: 'Fan-out', of: side => side.fanOut },
  { name: 'Fan-in', of: side => side.fanIn },
  { name: 'Churn', of: side => side.churn, finding: 'hotspot' },
];

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
    <td>
      {`${valueText(before)} → ${valueText(after)}`}
      <small>{caption({ base, head, before, after })}</small>
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
    <h3>{name}</h3>
    <p className="metric-tile-value">{value}</p>
    {caption && <p className="metric-tile-caption">{caption}</p>}
  </div>
);

type MetricsScreenProps = {
  readonly review: PageData;
  readonly onGoTo: (id: string) => void;
};

export const MetricsScreen = ({ review, onGoTo }: MetricsScreenProps) => {
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
                <th scope="row">
                  <ChangeMark state={node.state} />
                  <button type="button" onClick={() => onGoTo(node.id)}>
                    {node.label}
                  </button>
                  <span>{stack}</span>
                </th>
                {COLUMNS.map(({ name, of, finding }) => (
                  <Cell
                    key={name}
                    of={of}
                    base={base}
                    head={head}
                    finding={review.metricFindings.find(
                      ({ node: at, metric }) => at === node.id && metric === finding,
                    )}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
};
