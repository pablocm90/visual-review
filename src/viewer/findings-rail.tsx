import { useState } from 'react';
import type { MetricFinding } from '../core/metric-findings.ts';
import type { ReviewNotes } from '../core/notes.ts';
import type { PageData } from '../core/page.ts';
import { LevelMark, tenths } from './metrics-tab.tsx';

type FindingsRailProps = {
  readonly notes: ReviewNotes | undefined;
  readonly review: Pick<PageData, 'diff' | 'metricFindings' | 'dangling' | 'undrawn'>;
};

type Level = MetricFinding['level'];

type Finding = {
  readonly level: Level;
  readonly said?: { readonly sentence: string; readonly target: string };
};

const METRIC_NAMES = { cyclomatic: 'cyclomatic', lines: 'lines', abc: 'ABC size' } as const;

const move = (base: number | undefined, head: number) =>
  base === undefined ? `${tenths(head)}` : `${tenths(base)} → ${tenths(head)}`;

const sentenceOf = (finding: MetricFinding) => {
  if (finding.metric !== 'hotspot') {
    const { metric, base, head, threshold } = finding;
    return `${METRIC_NAMES[metric]} ${move(base, head)}, over ${threshold}`;
  }
  const { base, head, threshold } = finding;
  return `hotspot, churn ${move(base?.churn, head.churn)} and cyclomatic ${move(base?.cyclomatic, head.cyclomatic)}, over ${threshold.churn} and ${threshold.cyclomatic}`;
};

type Group = { readonly name: string; readonly findings: ReadonlyArray<Finding> };

const groupsOf = ({ notes, review }: FindingsRailProps): ReadonlyArray<Group> => {
  const labelOf = new Map(review.diff.nodes.map(node => [node.id, node.label]));
  return [
    {
      name: 'Flagged in notes',
      findings: Object.values(notes?.notes ?? {}).flatMap(note =>
        note.flag ? [{ level: 'look' as const }] : [],
      ),
    },
    {
      name: 'Metrics',
      findings: review.metricFindings.map(finding => ({
        level: finding.level,
        said: { sentence: sentenceOf(finding), target: labelOf.get(finding.node) ?? finding.node },
      })),
    },
    {
      name: 'Not drawn',
      findings: [review.dangling, review.undrawn].flatMap(lines =>
        lines.length > 0 ? [{ level: 'info' as const }] : [],
      ),
    },
  ];
};

export const FindingsRail = (props: FindingsRailProps) => {
  const [open, setOpen] = useState(false);
  const groups = groupsOf(props).filter(group => group.findings.length > 0);
  const levels: ReadonlyArray<Level> = groups.flatMap(group =>
    group.findings.map(finding => finding.level),
  );
  const counted = (level: Level) => (
    <span className="findings-count">
      <LevelMark level={level} />
      {levels.filter(each => each === level).length}
    </span>
  );
  if (open) {
    return (
      <aside className="findings" aria-label="Findings">
        <h2 className="findings-title">Findings</h2>
        <button type="button" aria-label="Hide findings" onClick={() => setOpen(false)}>
          ‹
        </button>
        {groups.map(group => (
          <section key={group.name} aria-label={group.name}>
            <h3>{group.name}</h3>
            <ul>
              {group.findings.flatMap(({ level, said }) =>
                said
                  ? [
                      <li className="finding" key={`${said.target}: ${said.sentence}`}>
                        <LevelMark level={level} />
                        <button type="button" aria-label={`${said.target}: ${said.sentence}`}>
                          <span>{said.sentence}</span>
                          <code className="finding-target">{said.target}</code>
                        </button>
                      </li>,
                    ]
                  : [],
              )}
            </ul>
          </section>
        ))}
      </aside>
    );
  }
  return (
    <nav className="findings-rail" aria-label="Findings">
      <button
        type="button"
        aria-label={`Show ${levels.length} findings`}
        onClick={() => setOpen(true)}
      >
        {levels.length}
      </button>
      {counted('look')}
      {counted('info')}
    </nav>
  );
};
