import { useRef, useState } from 'react';
import {
  counted,
  DIMENSIONS,
  type Dimension,
  type Finding,
  lookFirst,
  skippedFindingId,
} from '../core/findings.ts';
import { endsOfId } from '../core/graph.ts';
import type { PageData } from '../core/page.ts';
import type { Answer } from '../core/review.ts';
import { notReadLine } from '../core/skipped.ts';
import {
  AnswerButtons,
  type Answers,
  type AnswerTo,
  findingLine,
  LevelMark,
} from './finding-display.tsx';

type FindingsRailProps = {
  readonly findings: ReadonlyArray<Finding>;
  readonly open: boolean;
  readonly onOpen: (open: boolean) => void;
  readonly review: Pick<PageData, 'diff' | 'skipped'>;
  readonly onGoTo: (id: string) => void;
  readonly onShowOutside: (opener: HTMLButtonElement) => void;
  readonly answers: Answers;
  readonly onAnswer: AnswerTo | undefined;
};

type Level = Finding['level'];

type Line = {
  readonly id: string;
  readonly level: Level;
  readonly sentence: string;
  readonly target: string;
  readonly act?: (opener: HTMLButtonElement) => void;
  readonly groups?: ReadonlyArray<{
    readonly first: string;
    readonly name: string;
    readonly go: () => void;
  }>;
};

type Group = {
  readonly name: string;
  readonly findings: ReadonlyArray<Line>;
};

export const nameOf = (dimension: Dimension) => {
  if (dimension === 'api') return 'API';
  const words = dimension.replace('-', ' ');
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
};

type LineOptions = {
  readonly review: Pick<PageData, 'diff'>;
  readonly onGoTo: (id: string) => void;
  readonly onShowOutside: (opener: HTMLButtonElement) => void;
};

const linesOf = ({ review, onGoTo, onShowOutside }: LineOptions) => {
  const labelOf = new Map(review.diff.nodes.map(node => [node.id, node.label]));
  const targetOf = (id: string) =>
    endsOfId(id)
      .map(end => labelOf.get(end) ?? end)
      .join(' → ');
  const placeOf = new Map(review.diff.nodes.map(node => [node.id, node.path || node.label]));
  const lineOf = (finding: Finding): Line => {
    const { id, level, target, title, detail, groups } = finding;
    if (target !== undefined) {
      return {
        id,
        level,
        sentence: findingLine(finding),
        target: targetOf(target),
        act: () => onGoTo(target),
      };
    }
    return {
      id,
      level,
      sentence: title,
      target: detail ?? '',
      ...(id === 'structure:undrawn' && { act: onShowOutside }),
      ...(groups && {
        groups: groups.flatMap(group =>
          group.slice(0, 1).map(first => ({
            first,
            name: `${counted(group.length, 'part', 'parts')}, from ${placeOf.get(first) ?? first}`,
            go: () => onGoTo(first),
          })),
        ),
      }),
    };
  };
  return lineOf;
};

const groupsOf = (props: FindingsRailProps): ReadonlyArray<Group> => {
  const lineOf = linesOf(props);
  const alerted = new Set(props.review.skipped.map(skippedFindingId));
  const listed = props.findings.filter(finding => !alerted.has(finding.id));
  return DIMENSIONS.map(dimension => ({
    name: nameOf(dimension),
    findings: listed.filter(finding => finding.dimension === dimension).map(lineOf),
  }));
};

type FindingItemProps = {
  readonly finding: Line;
  readonly answer?: Answer | undefined;
  readonly onAnswer?: AnswerTo | undefined;
};

const FindingItem = ({ finding, answer, onAnswer }: FindingItemProps) => {
  const said = (
    <>
      <span>{finding.sentence}</span>
      {finding.groups ? (
        <span className="finding-target">{finding.target}</span>
      ) : (
        <code className="finding-target">{finding.target}</code>
      )}
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
      {finding.groups && (
        <ul className="finding-groups">
          {finding.groups.map(({ first, name, go }) => (
            <li key={first}>
              <button type="button" className="finding-group" onClick={go}>
                {name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {onAnswer && <AnswerButtons id={finding.id} answer={answer} onAnswer={onAnswer} />}
    </li>
  );
};

export const FindingsRail = (props: FindingsRailProps) => {
  const { open } = props;
  const toggled = useRef(false);
  const toggle = (opening: boolean) => {
    toggled.current = true;
    props.onOpen(opening);
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
        {groups.map(group => (
          <section key={group.name} aria-label={group.name}>
            <h3>{group.name}</h3>
            <ul>
              {group.findings.map(finding => (
                <FindingItem
                  key={finding.id}
                  finding={finding}
                  answer={props.answers[finding.id]}
                  onAnswer={props.onAnswer}
                />
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

type TriageStripProps = {
  readonly findings: ReadonlyArray<Finding>;
  readonly picked: Dimension | undefined;
  readonly onPick: (dimension: Dimension | undefined) => void;
};

export const TriageStrip = ({ findings, picked, onPick }: TriageStripProps) => {
  const chips = DIMENSIONS.map(dimension => ({
    dimension,
    found: findings.filter(finding => finding.dimension === dimension),
  })).filter(({ found }) => found.length > 0);
  if (chips.length === 0) return null;
  return (
    <div className="triage" role="group" aria-label="Triage">
      {chips.map(({ dimension, found }) => (
        <button
          key={dimension}
          className="chip"
          type="button"
          aria-pressed={dimension === picked}
          onClick={() => onPick(dimension === picked ? undefined : dimension)}
        >
          {found.some(finding => finding.level === 'look') && <LevelMark level="look" />}
          {`${nameOf(dimension)} ${found.length}`}
        </button>
      ))}
    </div>
  );
};

type LookFirstProps = LineOptions & {
  readonly findings: ReadonlyArray<Finding>;
  readonly onShowAll: () => void;
  readonly review: Pick<PageData, 'diff' | 'metrics'>;
};

const LOOK_FIRST_SHOWN = 7;

export const LookFirst = (props: LookFirstProps) => {
  const [open, setOpen] = useState(true);
  const ranked = lookFirst({ findings: props.findings, metrics: props.review.metrics });
  if (ranked.length === 0) return null;
  const lineOf = linesOf(props);
  return (
    <section className="look-first" aria-label="Look first">
      <h2 className="look-first-title">
        <button
          type="button"
          className="look-first-toggle"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {`Look first: ${ranked.length}`}
        </button>
      </h2>
      {open && (
        <>
          <ul>
            {ranked.slice(0, LOOK_FIRST_SHOWN).map(finding => (
              <FindingItem key={finding.id} finding={lineOf(finding)} />
            ))}
          </ul>
          {ranked.length > LOOK_FIRST_SHOWN && (
            <button type="button" className="show-all" onClick={props.onShowAll}>
              {`Show all ${ranked.length}`}
            </button>
          )}
        </>
      )}
    </section>
  );
};
