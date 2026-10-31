import { useState } from 'react';
import type { MetricFinding } from '../core/metric-findings.ts';
import type { ReviewNotes } from '../core/notes.ts';
import type { PageData } from '../core/page.ts';
import { LevelMark } from './metrics-tab.tsx';

type FindingsRailProps = {
  readonly notes: ReviewNotes | undefined;
  readonly review: Pick<PageData, 'metricFindings' | 'dangling' | 'undrawn'>;
};

type Level = MetricFinding['level'];

const groupsOf = ({ notes, review }: FindingsRailProps) => [
  {
    name: 'Flagged in notes',
    levels: Object.values(notes?.notes ?? {}).flatMap(note => (note.flag ? ['look' as const] : [])),
  },
  { name: 'Metrics', levels: review.metricFindings.map(finding => finding.level) },
  {
    name: 'Not drawn',
    levels: [review.dangling, review.undrawn].flatMap(lines =>
      lines.length > 0 ? ['info' as const] : [],
    ),
  },
];

export const FindingsRail = (props: FindingsRailProps) => {
  const [open, setOpen] = useState(false);
  const groups = groupsOf(props).filter(group => group.levels.length > 0);
  const levels: ReadonlyArray<Level> = groups.flatMap(group => group.levels);
  const counted = (level: Level) => (
    <span className="findings-count">
      <LevelMark level={level} />
      {levels.filter(each => each === level).length}
    </span>
  );
  if (open) {
    return (
      <aside className="findings" aria-label="Findings">
        <h2>Findings</h2>
        <button type="button" aria-label="Hide findings" onClick={() => setOpen(false)}>
          ‹
        </button>
        {groups.map(group => (
          <h3 key={group.name}>{group.name}</h3>
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
