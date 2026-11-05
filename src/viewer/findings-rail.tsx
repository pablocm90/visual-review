import { type ReactNode, useRef, useState } from 'react';
import {
  counted,
  DIMENSIONS,
  type Dimension,
  type Finding,
  skippedFindingId,
} from '../core/findings.ts';
import { endsOfId } from '../core/graph.ts';
import type { PageData } from '../core/page.ts';
import type { Answer } from '../core/review.ts';
import { notReadLine } from '../core/skipped.ts';
import { type StartHereLine, startHere } from '../core/start-here.ts';
import {
  AnswerButtons,
  type Answers,
  type AnswerTo,
  findingLine,
  LevelMark,
} from './finding-display.tsx';
import { SaidBefore } from './said-before.tsx';

type FindingsRailProps = {
  readonly findings: ReadonlyArray<Finding>;
  readonly open: boolean;
  readonly onOpen: (open: boolean) => void;
  readonly review: Pick<PageData, 'diff' | 'skipped' | 'sinceReview'>;
  readonly onGoTo: (id: string) => void;
  readonly onShowOutside: (opener: HTMLButtonElement) => void;
  readonly onShowFile: (path: string, opener: HTMLButtonElement, table?: string) => void;
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
  readonly onShowFile: (path: string, opener: HTMLButtonElement, table?: string) => void;
};

const linesOf = ({ review, onGoTo, onShowOutside, onShowFile }: LineOptions) => {
  const labelOf = new Map(review.diff.nodes.map(node => [node.id, node.label]));
  const targetOf = (id: string) =>
    endsOfId(id)
      .map(end => labelOf.get(end) ?? end)
      .join(' → ');
  const placeOf = new Map(review.diff.nodes.map(node => [node.id, node.path || node.label]));
  const lineOf = (finding: Finding): Line => {
    const { id, level, target, file, table, title, detail, groups } = finding;
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
      ...(file !== undefined && {
        act: (opener: HTMLButtonElement) => onShowFile(file, opener, table),
      }),
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
  readonly calledFine?: boolean | undefined;
  readonly answer?: Answer | undefined;
  readonly onAnswer?: AnswerTo | undefined;
  readonly children?: ReactNode;
};

const FindingSaid = ({ finding, calledFine }: Pick<FindingItemProps, 'finding' | 'calledFine'>) => (
  <>
    <span>{finding.sentence}</span>
    {calledFine && <span className="called-fine">called fine</span>}
    {finding.groups ? (
      <span className="finding-target">{finding.target}</span>
    ) : (
      <code className="finding-target">{finding.target}</code>
    )}
  </>
);

const FindingItem = ({ finding, calledFine, answer, onAnswer, children }: FindingItemProps) => {
  const said = <FindingSaid finding={finding} calledFine={calledFine} />;
  return (
    <li className="finding">
      <LevelMark level={finding.level} />
      {finding.act ? (
        <button
          type="button"
          aria-label={`${finding.target ? `${finding.target}: ` : ''}${finding.sentence}${calledFine ? ', called fine' : ''}`}
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
      {children}
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
                  calledFine={props.review.sinceReview?.calledFine.includes(finding.id)}
                  answer={props.answers[finding.id]}
                  onAnswer={props.onAnswer}
                >
                  <SaidBefore on={{ kind: 'finding', id: finding.id }} />
                </FindingItem>
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

type StartHereProps = LineOptions & {
  readonly findings: ReadonlyArray<Finding>;
  readonly onShowAll: () => void;
  readonly review: Pick<PageData, 'diff' | 'metrics' | 'sinceReview'>;
};

type SeveralFindingsProps = {
  readonly line: StartHereLine;
  readonly lineOf: (finding: Finding) => Line;
};

const SeveralFindings = ({ line, lineOf }: SeveralFindingsProps) => {
  const [open, setOpen] = useState(false);
  const heading = `${line.title}${line.files > 0 ? ` · ${counted(line.files, 'file', 'files')}` : ''}`;
  return (
    <li className="finding start-here-several">
      <LevelMark level={line.level} />
      <button
        type="button"
        aria-label={heading}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span>{heading}</span>
        <span className="start-here-names">{line.names.join(', ')}</span>
      </button>
      {open && (
        <ul className="start-here-opened">
          {line.findings.map(finding => (
            <FindingItem key={finding.id} finding={lineOf(finding)} />
          ))}
        </ul>
      )}
    </li>
  );
};

export const StartHere = (props: StartHereProps) => {
  const [open, setOpen] = useState(true);
  const calledFine = props.review.sinceReview?.calledFine ?? [];
  const { lines, look, total } = startHere({
    findings: props.findings.filter(finding => !calledFine.includes(finding.id)),
    metrics: props.review.metrics,
    nodes: props.review.diff.nodes,
  });
  if (lines.length === 0) return null;
  const lineOf = linesOf(props);
  return (
    <section className="start-here" aria-label="Start here">
      <div className="start-here-head">
        <h2 className="start-here-title">
          <button
            type="button"
            className="start-here-toggle"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            Start here
          </button>
        </h2>
        <span className="start-here-count">
          {look > 0
            ? counted(look, 'finding needs a look', 'findings need a look')
            : `nothing needs a look · ${counted(total, 'finding', 'findings')}`}
        </span>
        <button type="button" className="show-all" onClick={props.onShowAll}>
          All findings
        </button>
      </div>
      {open && (
        <ul>
          {lines.map(line =>
            line.findings.length === 1 ? (
              line.findings.map(finding => <FindingItem key={line.key} finding={lineOf(finding)} />)
            ) : (
              <SeveralFindings key={line.key} line={line} lineOf={lineOf} />
            ),
          )}
        </ul>
      )}
    </section>
  );
};
