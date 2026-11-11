import { type ReactNode, useRef, useState } from 'react';
import {
  counted,
  DIMENSIONS,
  type Dimension,
  type Finding,
  type PlaceInFile,
  skippedFindingId,
} from '../core/findings.ts';
import { endsOfId } from '../core/graph.ts';
import type { LogicTotals } from '../core/logic-strip.ts';
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
import { LENS_OF, LENSES, type Lens } from './lenses.ts';
import { SaidBefore } from './said-before.tsx';

type FindingsRailProps = {
  readonly findings: ReadonlyArray<Finding>;
  readonly open: boolean;
  readonly onOpen: (open: boolean) => void;
  readonly review: Pick<PageData, 'diff' | 'skipped' | 'sinceReview'>;
  readonly onGoTo: (id: string) => void;
  readonly onGoToFinding: (id: string, finding: string) => void;
  readonly onShowOutside: (opener: HTMLButtonElement) => void;
  readonly onShowFile: (path: string, opener: HTMLButtonElement, place: PlaceInFile) => void;
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

const nameOf = (dimension: Dimension) => {
  if (dimension === 'api') return 'API';
  const words = dimension.replace('-', ' ');
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
};

type LineOptions = {
  readonly review: Pick<PageData, 'diff'>;
  readonly onGoTo: (id: string) => void;
  readonly onGoToFinding: (id: string, finding: string) => void;
  readonly onShowOutside: (opener: HTMLButtonElement) => void;
  readonly onShowFile: (path: string, opener: HTMLButtonElement, place: PlaceInFile) => void;
};

const linesOf = ({ review, onGoTo, onGoToFinding, onShowOutside, onShowFile }: LineOptions) => {
  const labelOf = new Map(review.diff.nodes.map(node => [node.id, node.label]));
  const targetOf = (id: string) =>
    endsOfId(id)
      .map(end => labelOf.get(end) ?? end)
      .join(' → ');
  const placeOf = new Map(review.diff.nodes.map(node => [node.id, node.path || node.label]));
  const lineOf = (finding: Finding): Line => {
    const { id, level, target, file, title, detail, groups } = finding;
    if (target !== undefined) {
      return {
        id,
        level,
        sentence: findingLine(finding),
        target: targetOf(target),
        act: () => onGoToFinding(target, id),
      };
    }
    return {
      id,
      level,
      sentence: title,
      target: detail ?? '',
      ...(id === 'structure:undrawn' && { act: onShowOutside }),
      ...(file !== undefined && {
        act: (opener: HTMLButtonElement) => onShowFile(file, opener, finding),
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

const LensOf = ({ dimension }: { readonly dimension: Dimension }) => (
  <span className="start-here-lens">
    {LENS_OF[dimension]} · {nameOf(dimension).toLowerCase()}
  </span>
);

type FindingItemProps = {
  readonly finding: Line;
  readonly lens?: Dimension;
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

const FindingItem = ({
  finding,
  lens,
  calledFine,
  answer,
  onAnswer,
  children,
}: FindingItemProps) => {
  const said = <FindingSaid finding={finding} calledFine={calledFine} />;
  return (
    <li className="finding">
      <LevelMark level={finding.level} />
      {lens && <LensOf dimension={lens} />}
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
          <p key={skippedFindingId(skip)} className="skipped" role="alert">
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
        <p
          key={skippedFindingId(skip)}
          className="rail-skipped"
          role="alert"
          title={notReadLine(skip)}
        >
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

const LensCount = ({
  findings,
  level,
}: {
  readonly findings: ReadonlyArray<Finding>;
  readonly level: Level;
}) => {
  const shown = findings.filter(finding => finding.level === level).length;
  return (
    shown > 0 && (
      <span className="lens-count">
        <LevelMark level={level} />
        {shown}
      </span>
    )
  );
};

type LensChipsProps = {
  readonly findings: ReadonlyArray<Finding>;
  readonly coverage: PageData['coverage'];
  readonly picked: Lens | undefined;
  readonly onPick: (lens: Lens | undefined) => void;
};

export const LensChips = ({ findings, coverage, picked, onPick }: LensChipsProps) => (
  <div className="lenses" role="group" aria-label="Lenses">
    {LENSES.map(lens => {
      const found = findings.filter(finding => LENS_OF[finding.dimension] === lens);
      const covered = coverage.filter(({ dimension }) => LENS_OF[dimension] === lens);
      const checked = found.length === 0 && covered.every(({ notRead }) => notRead.length === 0);
      const names = covered.map(({ dimension }) => nameOf(dimension).toLowerCase()).join(', ');
      return (
        <button
          key={lens}
          className={found.length > 0 ? 'chip' : 'chip chip-quiet'}
          type="button"
          aria-pressed={lens === picked}
          onClick={() => onPick(lens === picked ? undefined : lens)}
        >
          {checked ? `${lens} · ${names} checked, nothing found` : lens}
          <LensCount findings={found} level="info" />
          <LensCount findings={found} level="look" />
        </button>
      );
    })}
  </div>
);

type LensRowProps = {
  readonly picked: Lens | undefined;
  readonly findings: ReadonlyArray<Finding>;
  readonly coverage: PageData['coverage'];
};

const coverageLine = (found: number, notRead: ReadonlyArray<string>) => {
  const reasons = notRead.join(' · ');
  if (found === 0) return reasons || 'checked, none';
  return reasons && `· ${reasons}`;
};

export const LensRow = ({ picked, findings, coverage }: LensRowProps) => {
  if (picked === undefined) return null;
  return (
    <ul className="lens-row" aria-label={`${picked} dimensions`}>
      {DIMENSIONS.filter(dimension => LENS_OF[dimension] === picked).flatMap(dimension => {
        const found = findings.filter(finding => finding.dimension === dimension);
        const entry = coverage.find(covered => covered.dimension === dimension);
        if (entry === undefined && found.length === 0) return [];
        return [
          <li key={dimension} className="lens-row-item">
            <span className="lens-row-name">{nameOf(dimension)}</span>
            <LensCount findings={found} level="info" />
            <LensCount findings={found} level="look" />
            {coverageLine(found.length, entry?.notRead ?? [])}
          </li>,
        ];
      })}
    </ul>
  );
};

/** Which of Start here's lists are open under its line: what needs a look, and the rest. */
export type StartHereOpened = { readonly look: boolean; readonly information: boolean };

type StartHereProps = LineOptions & {
  readonly findings: ReadonlyArray<Finding>;
  readonly allFindings: ReadonlyArray<Finding>;
  readonly coverage: PageData['coverage'];
  readonly picked: Lens | undefined;
  readonly onPick: (lens: Lens | undefined) => void;
  readonly onShowAll: () => void;
  readonly opened: StartHereOpened;
  readonly onOpened: (opened: StartHereOpened) => void;
  readonly review: Pick<PageData, 'diff' | 'metrics' | 'sinceReview'>;
  readonly logic: StartHereLogicProps | undefined;
};

type StartHereLogicProps = {
  readonly totals: LogicTotals;
  readonly onShow: () => void;
};

const StartHereLogic = ({ totals, onShow }: StartHereLogicProps) => (
  <span className="start-here-logic">
    <button type="button" className="start-here-count-button" onClick={onShow}>
      {counted(totals.decisions, 'decision', 'decisions')} changed in{' '}
      {counted(totals.functions, 'function', 'functions')}, {counted(totals.files, 'file', 'files')}
    </button>
    <span className="start-here-breakdown">
      {[
        totals.exits > 0 ? counted(totals.exits, 'exit', 'exits') : undefined,
        ...(['added', 'changed', 'removed', 'moved'] as const).map(change =>
          totals[change] > 0 ? `${totals[change]} ${change}` : undefined,
        ),
      ]
        .filter(part => part !== undefined)
        .join(' · ')}
    </span>
  </span>
);

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
      <LensOf dimension={line.dimension} />
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

const lookCount = (front: ReadonlyArray<StartHereLine>, cut: number) => {
  const look = front.filter(line => line.level === 'look').length + cut;
  const blind = front.filter(line => line.level !== 'look').length;
  return [look > 0 ? `${look} to look at` : undefined, blind > 0 ? `${blind} not read` : undefined]
    .filter(part => part !== undefined)
    .join(' · ');
};

type StartHereListProps = {
  readonly label: string;
  readonly lines: ReadonlyArray<StartHereLine>;
  readonly cut?: number;
  readonly lineOf: (finding: Finding) => Line;
  readonly onShowAll: () => void;
};

const StartHereList = ({ label, lines, cut = 0, lineOf, onShowAll }: StartHereListProps) => {
  const lineOfOne = (finding: Finding): Line => {
    const { groups, ...line } = lineOf(finding);
    return groups ? { ...line, target: '', act: onShowAll } : line;
  };
  return (
    <ul className="start-here-list" aria-label={label}>
      {lines.map(line =>
        line.findings.length === 1 ? (
          line.findings.map(finding => (
            <FindingItem key={line.key} finding={lineOfOne(finding)} lens={line.dimension} />
          ))
        ) : (
          <SeveralFindings key={line.key} line={line} lineOf={lineOf} />
        ),
      )}
      {cut > 0 && (
        <li className="finding start-here-more">
          <button type="button" onClick={onShowAll}>
            and {cut} more in All findings
          </button>
        </li>
      )}
    </ul>
  );
};

/**
 * One line above the graph: what needs a look (open by default), the range's changed logic, and a
 * count of what is for information, which opens with the lenses that narrow it.
 */
export const StartHere = (props: StartHereProps) => {
  const { opened, onOpened } = props;
  const calledFine = props.review.sinceReview?.calledFine ?? [];
  const { front, frontCut, rest, information } = startHere({
    findings: props.findings.filter(finding => !calledFine.includes(finding.id)),
    metrics: props.review.metrics,
    nodes: props.review.diff.nodes,
  });
  const anyFindings = props.allFindings.length > 0;
  const lineOf = linesOf(props);
  const toggle = (list: keyof StartHereOpened) => onOpened({ ...opened, [list]: !opened[list] });
  return (
    <section className="start-here" aria-label="Start here">
      <div className="start-here-head">
        <h2 className="visually-hidden">Start here</h2>
        {front.length > 0 ? (
          <button
            type="button"
            className="start-here-count-button start-here-look"
            aria-expanded={opened.look}
            onClick={() => toggle('look')}
          >
            <span className="start-here-dot" aria-hidden="true" />
            {lookCount(front, frontCut)}
          </button>
        ) : (
          <span className="start-here-count">nothing needs a look</span>
        )}
        {props.logic && <StartHereLogic {...props.logic} />}
        <button
          type="button"
          className="start-here-count-button start-here-information"
          aria-expanded={opened.information}
          onClick={() => toggle('information')}
        >
          {anyFindings ? `${information} for information` : 'what was checked'}
        </button>
        {anyFindings && (
          <button type="button" className="show-all" onClick={props.onShowAll}>
            All findings
          </button>
        )}
      </div>
      {opened.look && front.length > 0 && (
        <StartHereList
          label="Needs a look"
          lines={front}
          cut={frontCut}
          lineOf={lineOf}
          onShowAll={props.onShowAll}
        />
      )}
      {opened.information && (
        <div className="start-here-information-list">
          <LensChips
            findings={props.allFindings}
            coverage={props.coverage}
            picked={props.picked}
            onPick={props.onPick}
          />
          <LensRow picked={props.picked} findings={props.allFindings} coverage={props.coverage} />
          <StartHereList
            label="For information"
            lines={rest}
            lineOf={lineOf}
            onShowAll={props.onShowAll}
          />
        </div>
      )}
    </section>
  );
};
