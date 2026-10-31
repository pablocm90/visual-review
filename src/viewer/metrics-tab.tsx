import type { MetricFinding } from '../core/metric-findings.ts';
import type { FunctionCyclomatic, NodeMeasures, NodeMetrics } from '../core/metrics.ts';
import { LevelMark, tenths } from './finding-display.tsx';

type MetricRow = {
  readonly name: string;
  readonly hint: string;
  readonly of: (measures: NodeMeasures) => number | undefined;
  readonly finding?: MetricFinding['metric'];
};

const METRIC_ROWS: ReadonlyArray<MetricRow> = [
  {
    name: 'Lines',
    hint: 'non-blank, non-comment',
    of: m => ('lines' in m ? m.lines : undefined),
    finding: 'lines',
  },
  { name: 'Functions', hint: '', of: m => ('lines' in m ? m.functions : undefined) },
  {
    name: 'Cyclomatic, highest',
    hint: 'its most branching function',
    of: m => ('lines' in m ? m.cyclomatic.highest : undefined),
    finding: 'cyclomatic',
  },
  {
    name: 'Cyclomatic, total',
    hint: 'summed over its functions',
    of: m => ('lines' in m ? m.cyclomatic.total : undefined),
  },
  {
    name: 'ABC size',
    hint: 'assignments, branches, conditions',
    of: m => ('lines' in m ? m.abc : undefined),
    finding: 'abc',
  },
  { name: 'Fan-out', hint: 'nodes it depends on', of: m => m.fanOut },
  { name: 'Fan-in', hint: 'nodes depending on it', of: m => m.fanIn },
  {
    name: 'Churn',
    hint: 'commits in the window before each side',
    of: m => m.churn,
    finding: 'hotspot',
  },
];

const shownValue = (side: NodeMeasures | undefined, value: number | undefined) => {
  if (side === undefined) return '—';
  return value === undefined ? 'not measured' : String(tenths(value));
};

const difference = (base: number | undefined, head: number | undefined) => {
  if (base === undefined || head === undefined) return '—';
  const by = tenths(head - base);
  if (by > 0) return `+${by}`;
  return by < 0 ? `−${-by}` : '±0';
};

type MetricsTableProps = {
  readonly metrics: NodeMetrics;
  readonly findings: ReadonlyArray<MetricFinding>;
};

const barWidth = (value: number, scale: number) =>
  `${scale > 0 ? Math.max(2, Math.round((value / scale) * 100)) : 2}%`;

const Bars = ({
  before,
  after,
}: {
  readonly before: number | undefined;
  readonly after: number | undefined;
}) => {
  const scale = Math.max(before ?? 0, after ?? 0);
  return (
    <span className="bars" aria-hidden="true">
      {before !== undefined && (
        <span className="before" style={{ width: barWidth(before, scale) }} />
      )}
      {after !== undefined && <span className="after" style={{ width: barWidth(after, scale) }} />}
    </span>
  );
};

const numbered = (functions: ReadonlyArray<FunctionCyclomatic>) =>
  functions.map(({ name, cyclomatic }, at) => ({
    name,
    cyclomatic,
    key: `${name}#${functions.slice(0, at).filter(other => other.name === name).length}`,
  }));

const functionsOf = (side: NodeMeasures | undefined) =>
  numbered((side && 'lines' in side && side.cyclomatic.byFunction) || []);

type FunctionPair = {
  readonly key: string;
  readonly name: string;
  readonly base?: number;
  readonly head?: number;
};

const pairedFunctions = (base: NodeMeasures | undefined, head: NodeMeasures | undefined) => {
  const before = functionsOf(base);
  const after = functionsOf(head);
  const kept = after
    .map(({ key, name, cyclomatic }) => {
      const was = before.find(old => old.key === key);
      return was
        ? { key, name, base: was.cyclomatic, head: cyclomatic }
        : { key, name, head: cyclomatic };
    })
    .toSorted((one, other) => other.head - one.head);
  const removed = before
    .filter(({ key }) => !after.some(now => now.key === key))
    .map(({ key, name, cyclomatic }) => ({ key, name, base: cyclomatic }));
  return [...kept, ...removed];
};

const FUNCTION_MARKS = { added: '+ ', removed: '− ', modified: '~ ', unchanged: '' };

const functionState = ({ base, head }: FunctionPair): keyof typeof FUNCTION_MARKS => {
  if (base === undefined) return 'added';
  if (head === undefined) return 'removed';
  return base === head ? 'unchanged' : 'modified';
};

const Functions = ({ pairs }: { readonly pairs: ReadonlyArray<FunctionPair> }) =>
  pairs.length > 0 && (
    <>
      <h3 id="functions-by-cyclomatic">Functions by cyclomatic</h3>
      <ul className="functions" aria-labelledby="functions-by-cyclomatic">
        {pairs.map(pair => {
          const state = functionState(pair);
          return (
            <li key={pair.key} className={state}>
              <code>{`${FUNCTION_MARKS[state]}${pair.name}`}</code>{' '}
              <code>{`${pair.base ?? '—'} → ${pair.head ?? '—'}`}</code>
            </li>
          );
        })}
      </ul>
    </>
  );

export const MetricsTable = ({
  metrics: { highestInside, base, head },
  findings,
}: MetricsTableProps) => (
  <>
    <p className="metrics-caption">
      Base → head. Each row's bars share one scale: grey before, dark after.
    </p>
    {highestInside && <p>Each value is the highest inside it.</p>}
    <table className="metrics">
      <thead>
        <tr>
          <th scope="col">Metric</th>
          <th scope="col">Before</th>
          <th scope="col">After</th>
          <th scope="col">Δ</th>
        </tr>
      </thead>
      <tbody>
        {METRIC_ROWS.map(({ name, hint, of, finding }) => {
          const before = base && of(base);
          const after = head && of(head);
          const over = findings.find(({ metric }) => metric === finding);
          return (
            <tr key={name} className={over ? 'over' : undefined}>
              <th scope="row">
                {name}
                {over && <LevelMark level={over.level} />}
                {hint && <small>{hint}</small>}
                <Bars before={before} after={after} />
              </th>
              <td>{shownValue(base, before)}</td>
              <td>{shownValue(head, after)}</td>
              <td>{difference(before, after)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
    <Functions pairs={pairedFunctions(base, head)} />
  </>
);
