import { useRef, useState } from 'react';
import { endsOfId } from '../core/graph.ts';
import type { MetricFinding } from '../core/metric-findings.ts';
import type { ReviewNotes } from '../core/notes.ts';
import type { PageData } from '../core/page.ts';
import { notReadLine } from '../core/skipped.ts';
import { LevelMark, tenths } from './metrics-tab.tsx';

type FindingsRailProps = {
  readonly notes: ReviewNotes | undefined;
  readonly review: Pick<PageData, 'diff' | 'metricFindings' | 'dangling' | 'undrawn' | 'skipped'>;
  readonly onGoTo: (id: string) => void;
  readonly onShowOutside: (opener: HTMLButtonElement) => void;
};

type Level = MetricFinding['level'];

type Finding = {
  readonly level: Level;
  readonly sentence: string;
  readonly target: string;
  readonly act?: (opener: HTMLButtonElement) => void;
};

type NotDrawnOptions = {
  readonly paths: ReadonlyArray<string>;
  readonly one: string;
  readonly many: string;
  readonly act?: (opener: HTMLButtonElement) => void;
};

const notDrawn = ({ paths, one, many, ...rest }: NotDrawnOptions): ReadonlyArray<Finding> =>
  paths.length === 0
    ? []
    : [
        {
          level: 'info',
          sentence: `${paths.length} ${paths.length === 1 ? one : many}`,
          target: paths.join(', '),
          ...rest,
        },
      ];

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

type Group = {
  readonly name: string;
  readonly chip: string;
  readonly findings: ReadonlyArray<Finding>;
};

const groupsOf = ({
  notes,
  review,
  onGoTo,
  onShowOutside,
}: FindingsRailProps): ReadonlyArray<Group> => {
  const labelOf = new Map(review.diff.nodes.map(node => [node.id, node.label]));
  const targetOf = (id: string) =>
    endsOfId(id)
      .map(end => labelOf.get(end) ?? end)
      .join(' → ');
  return [
    {
      name: 'Flagged in notes',
      chip: 'Notes',
      findings: Object.entries(notes?.notes ?? {}).flatMap(([id, note]) =>
        note.flag
          ? [
              {
                level: 'look' as const,
                sentence: `${note.flag}: ${note.text}`,
                target: targetOf(id),
                act: () => onGoTo(id),
              },
            ]
          : [],
      ),
    },
    {
      name: 'Metrics',
      chip: 'Metrics',
      findings: review.metricFindings.map(finding => ({
        level: finding.level,
        sentence: sentenceOf(finding),
        target: targetOf(finding.node),
        act: () => onGoTo(finding.node),
      })),
    },
    {
      name: 'Not drawn',
      chip: 'Not drawn',
      findings: [
        ...notDrawn({
          paths: review.dangling.map(call => call.path),
          one: 'call with no route',
          many: 'calls with no route',
        }),
        ...notDrawn({
          paths: review.undrawn.map(patch => patch.path),
          one: 'changed file outside the graph',
          many: 'changed files outside the graph',
          act: onShowOutside,
        }),
      ],
    },
  ];
};

const FindingItem = ({ finding }: { readonly finding: Finding }) => {
  const said = (
    <>
      <span>{finding.sentence}</span>
      <code className="finding-target">{finding.target}</code>
    </>
  );
  return (
    <li className="finding">
      <LevelMark level={finding.level} />
      {finding.act ? (
        <button
          type="button"
          aria-label={`${finding.target}: ${finding.sentence}`}
          onClick={event => finding.act?.(event.currentTarget)}
        >
          {said}
        </button>
      ) : (
        <span className="finding-said">{said}</span>
      )}
    </li>
  );
};

export const FindingsRail = (props: FindingsRailProps) => {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string>();
  const toggled = useRef(false);
  const toggle = (opening: boolean) => {
    toggled.current = true;
    setOpen(opening);
  };
  const takeFocus = (button: HTMLButtonElement | null) => {
    if (!button || !toggled.current) return;
    toggled.current = false;
    button.focus();
  };
  const groups = groupsOf(props).filter(group => group.findings.length > 0);
  const levels: ReadonlyArray<Level> = groups.flatMap(group =>
    group.findings.map(finding => finding.level),
  );
  const chips = [
    { chip: 'All', pick: undefined, count: levels.length },
    ...groups.map(group => ({ chip: group.chip, pick: group.chip, count: group.findings.length })),
  ];
  const counted = (level: Level) => (
    <span className="findings-count">
      <LevelMark level={level} />
      {levels.filter(each => each === level).length}
    </span>
  );
  if (open) {
    return (
      <aside className="findings" aria-label="Findings">
        {props.review.skipped.map(skip => (
          <p key={skip.reader} className="skipped" role="alert">
            {notReadLine(skip)}
          </p>
        ))}
        <h2 className="findings-title">Findings</h2>
        <button
          type="button"
          aria-label="Hide findings"
          ref={takeFocus}
          onClick={() => toggle(false)}
        >
          ‹
        </button>
        <div className="rail-chips" role="group" aria-label="Show findings">
          {chips.map(({ chip, pick, count }) => (
            <button
              key={chip}
              className="chip"
              type="button"
              aria-pressed={pick === picked}
              onClick={() => setPicked(pick)}
            >
              {`${chip} ${count}`}
            </button>
          ))}
        </div>
        {groups
          .filter(group => picked === undefined || group.chip === picked)
          .map(group => (
            <section key={group.name} aria-label={group.name}>
              <h3>{group.name}</h3>
              <ul>
                {group.findings.map(finding => (
                  <FindingItem key={`${finding.target}: ${finding.sentence}`} finding={finding} />
                ))}
              </ul>
            </section>
          ))}
      </aside>
    );
  }
  return (
    <nav className="findings-rail" aria-label="Findings">
      {props.review.skipped.map(skip => (
        <p key={skip.reader} className="rail-skipped" role="alert" title={notReadLine(skip)}>
          <span aria-hidden="true">!</span>
          <span className="visually-hidden">{notReadLine(skip)}</span>
        </p>
      ))}
      <button
        type="button"
        aria-label={`Show ${levels.length} ${levels.length === 1 ? 'finding' : 'findings'}`}
        ref={takeFocus}
        onClick={() => toggle(true)}
      >
        {levels.length}
      </button>
      {counted('look')}
      {counted('info')}
    </nav>
  );
};
