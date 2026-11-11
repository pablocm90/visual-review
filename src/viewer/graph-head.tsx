import { useId, useState } from 'react';
import type { GraphDiff } from '../core/diff-graphs.ts';
import type { Finding, PlaceInFile } from '../core/findings.ts';
import { logicTotalsOf } from '../core/logic-strip.ts';
import type { ReviewNotes } from '../core/notes.ts';
import type { PageData } from '../core/page.ts';
import type { ChangedSince } from '../core/since-review.ts';
import { ColourBy, type Colouring, ScaleLegend } from './colour-by.tsx';
import { StartHere, type StartHereOpened } from './findings-rail.tsx';
import { Legend } from './graph-drawing.tsx';
import { LENS_OF, type Lens } from './lenses.ts';
import { CARD_DEPTHS, type CardDepth } from './logic-card.tsx';
import { NextToIt } from './next-to-it.tsx';
import type { ReviewPageProps } from './review-page.tsx';
import { LOGIC_ONLY, type Scope } from './scopes.ts';

type SummaryProps = {
  readonly notes: ReviewNotes;
  readonly onGoTo: (id: string) => void;
};

const Summary = ({ notes, onGoTo }: SummaryProps) => {
  return (
    <section className="summary" aria-label="Summary">
      <h2 className="summary-title">Summary</h2>
      <ul>
        {notes.summary.map(({ text, target }) => (
          <li key={`${target}:${text}`}>
            {target === undefined ? (
              text
            ) : (
              <button type="button" onClick={() => onGoTo(target)}>
                {text}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
};

type ShowProps = {
  readonly scopes: ReadonlyArray<Scope>;
  readonly scope: Scope;
  readonly onPick: (scope: Scope) => void;
};

const Show = ({ scopes, scope, onPick }: ShowProps) => {
  const label = useId();
  return (
    <div className="graph-choice">
      <span id={label}>Show</span>
      <div role="group" aria-labelledby={label}>
        {scopes.map(each => (
          <button
            key={each[0]}
            type="button"
            aria-pressed={each === scope}
            onClick={() => onPick(each)}
          >
            {each[0]}
          </button>
        ))}
      </div>
    </div>
  );
};

type GraphCaveatProps = {
  readonly since: ChangedSince | undefined;
  readonly nothingDrawn: boolean;
};

const GraphCaveat = ({ since, nothingDrawn }: GraphCaveatProps) => {
  const dropped = since === undefined ? [] : Object.values(since.dropped).flat();
  if (dropped.length > 0)
    return (
      <p className="caveat">
        Gone from the PR since the last review, so not shown: {dropped.join(', ')}
      </p>
    );
  if (!nothingDrawn) return null;
  return (
    <p className="caveat">
      {since === undefined
        ? 'Nothing in the graph changed.'
        : 'Nothing in the graph changed since the last review.'}
    </p>
  );
};

type GraphControlsProps = {
  readonly cardDepth: CardDepth;
  readonly onCardDepth: (depth: CardDepth) => void;
  readonly colouring: Colouring;
  readonly onColouring: (colouring: Colouring) => void;
  readonly scopes: ReadonlyArray<Scope>;
  readonly scope: Scope;
  readonly onScope: (scope: Scope) => void;
  readonly allEdges: boolean;
  readonly onAllEdges: (allEdges: boolean) => void;
};

const CardDepths = ({
  depth,
  onPick,
}: {
  readonly depth: CardDepth;
  readonly onPick: (depth: CardDepth) => void;
}) => {
  const label = useId();
  return (
    <div className="graph-choice">
      <span id={label}>Cards</span>
      <div role="group" aria-labelledby={label}>
        {CARD_DEPTHS.map(([id, name]) => (
          <button key={id} type="button" aria-pressed={id === depth} onClick={() => onPick(id)}>
            {name}
          </button>
        ))}
      </div>
    </div>
  );
};

const GraphControls = ({
  cardDepth,
  onCardDepth,
  colouring,
  onColouring,
  scopes,
  scope,
  onScope,
  allEdges,
  onAllEdges,
}: GraphControlsProps) => {
  const [viewOpen, setViewOpen] = useState(false);
  const menu = useId();
  return (
    <div className="graph-controls">
      <Show scopes={scopes} scope={scope} onPick={onScope} />
      {scope[0] === LOGIC_ONLY && <CardDepths depth={cardDepth} onPick={onCardDepth} />}
      <div className="graph-key">
        {colouring === 'change' ? <Legend /> : <ScaleLegend colouring={colouring} />}
      </div>
      <div className="graph-view">
        <button
          type="button"
          className="graph-view-toggle"
          aria-expanded={viewOpen}
          aria-controls={menu}
          onClick={() => setViewOpen(!viewOpen)}
        >
          View
        </button>
        {viewOpen && (
          <div className="graph-view-menu" id={menu}>
            <ColourBy
              colouring={colouring}
              onPick={onColouring}
              withLogic={scopes.some(([name]) => name === LOGIC_ONLY)}
            />
            <label className="near-only">
              <input
                type="checkbox"
                checked={allEdges}
                onChange={event => onAllEdges(event.target.checked)}
              />
              All edges
            </label>
          </div>
        )}
      </div>
    </div>
  );
};

type GraphHeadProps = GraphControlsProps &
  GraphCaveatProps & {
    readonly review: PageData;
    readonly notes: ReviewPageProps['notes'];
    readonly findings: ReadonlyArray<Finding>;
    readonly inLens: ReadonlyArray<Finding>;
    readonly picked: Lens | undefined;
    readonly onPick: (lens: Lens | undefined) => void;
    readonly onShowAll: () => void;
    readonly startHereOpened: StartHereOpened;
    readonly onStartHereOpened: (opened: StartHereOpened) => void;
    readonly onGoTo: (id: string) => void;
    readonly onGoToFinding: (id: string, finding: string) => void;
    readonly onShowOutside: (opener: HTMLButtonElement) => void;
    readonly onShowFile: (path: string, opener: HTMLButtonElement, place: PlaceInFile) => void;
  };

const logicLineOf = ({
  review,
  picked,
  scopes,
  onScope,
}: Pick<GraphHeadProps, 'review' | 'picked' | 'scopes' | 'onScope'>) => {
  const logicOnly = scopes.find(([name]) => name === LOGIC_ONLY);
  return logicOnly && (picked === undefined || picked === LENS_OF.logic)
    ? { totals: logicTotalsOf(review.symbols), onShow: () => onScope(logicOnly) }
    : undefined;
};

export const GraphHead = ({
  review,
  notes,
  findings,
  inLens,
  picked,
  onPick,
  onShowAll,
  startHereOpened,
  onStartHereOpened,
  onGoTo,
  onGoToFinding,
  onShowOutside,
  onShowFile,
  since,
  nothingDrawn,
  ...controls
}: GraphHeadProps) => (
  <>
    {notes && notes.summary.length > 0 && <Summary notes={notes} onGoTo={onGoTo} />}
    <StartHere
      findings={inLens}
      allFindings={findings}
      coverage={review.coverage}
      picked={picked}
      onPick={onPick}
      onShowAll={onShowAll}
      opened={startHereOpened}
      onOpened={onStartHereOpened}
      review={review}
      onGoTo={onGoTo}
      onGoToFinding={onGoToFinding}
      onShowOutside={onShowOutside}
      onShowFile={onShowFile}
      logic={logicLineOf({ review, picked, ...controls })}
    />
    <GraphControls {...controls} />
    <GraphCaveat since={since} nothingDrawn={nothingDrawn} />
  </>
);

type ReadingFootProps = {
  readonly diff: GraphDiff;
  readonly part: string | undefined;
  readonly read: ReadonlySet<string>;
  readonly anyFindings: boolean;
  readonly onGoTo: (id: string) => void;
  readonly onShowAllFindings: () => void;
};

export const ReadingFoot = ({
  diff,
  part,
  read,
  anyFindings,
  onGoTo,
  onShowAllFindings,
}: ReadingFootProps) => (
  <>
    {part !== undefined && <NextToIt diff={diff} part={part} read={read} onGoTo={onGoTo} />}
    {anyFindings && (
      <button type="button" className="all-findings" onClick={onShowAllFindings}>
        All findings
      </button>
    )}
  </>
);
