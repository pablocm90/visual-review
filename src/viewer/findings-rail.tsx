import type { MetricFinding } from '../core/metric-findings.ts';
import type { ReviewNotes } from '../core/notes.ts';
import type { PageData } from '../core/page.ts';
import { LevelMark } from './metrics-tab.tsx';

type FindingsRailProps = {
  readonly notes: ReviewNotes | undefined;
  readonly review: Pick<PageData, 'metricFindings' | 'dangling' | 'undrawn'>;
};

const levelsOf = ({ notes, review }: FindingsRailProps): ReadonlyArray<MetricFinding['level']> => [
  ...Object.values(notes?.notes ?? {}).flatMap(note => (note.flag ? ['look' as const] : [])),
  ...review.metricFindings.map(finding => finding.level),
  ...[review.dangling, review.undrawn].flatMap(lines =>
    lines.length > 0 ? ['info' as const] : [],
  ),
];

export const FindingsRail = (props: FindingsRailProps) => {
  const levels = levelsOf(props);
  const counted = (level: MetricFinding['level']) => (
    <span className="findings-count">
      <LevelMark level={level} />
      {levels.filter(each => each === level).length}
    </span>
  );
  return (
    <nav className="findings-rail" aria-label="Findings">
      <button type="button" aria-label={`Show ${levels.length} findings`}>
        {levels.length}
      </button>
      {counted('look')}
      {counted('info')}
    </nav>
  );
};
