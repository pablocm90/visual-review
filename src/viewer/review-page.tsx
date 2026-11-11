import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { anchorKey } from '../core/anchors.ts';
import type { DiffedNode } from '../core/diff-graphs.ts';
import { deepestHolding } from '../core/diff-graphs.ts';
import { anchorOfNoteFlag, findingsAt, findingsOf, type PlaceInFile } from '../core/findings.ts';
import { logicTotalsOf, nextDecision, walkOfDecisions } from '../core/logic-strip.ts';
import { notesOnTheGraph, type ReviewNotes, visibleNotes } from '../core/notes.ts';
import type { PageData } from '../core/page.ts';
import type { PreviousComment } from '../core/previous-comments.ts';
import type { Answer, Comment, Review } from '../core/review.ts';
import { boxesAboveIn, visibleDiff, visibleNodeOf } from '../core/visible-diff.ts';
import { lineAt, placeOfLine } from './anchors.ts';
import { ChangedSinceMarks } from './changed-since.tsx';
import { type Colouring, shadeOf } from './colour-by.tsx';
import { CommentAsked, type Comments, Drafting } from './comment-field.tsx';
import type { Answers, AnswerTo } from './finding-display.tsx';
import type { StartHereOpened } from './findings-rail.tsx';
import { GraphFrame } from './graph-drawing.tsx';
import { GraphHead, ReadingFoot } from './graph-head.tsx';
import { useGraphView } from './graph-view.tsx';
import { Header, type Tab, useTab } from './header.tsx';
import {
  type CommentAskedOn,
  type DiffNode,
  type LandingIn,
  rowOfFinding,
  useLanding,
} from './inspector.tsx';
import { type Layout, layoutDiff } from './layout.ts';
import { LeftColumn } from './left-column.tsx';
import { LENS_OF, type Lens } from './lenses.ts';
import { type CardDepth, type LogicCard, logicCardsOf } from './logic-card.tsx';
import { RowNotes } from './note-block.tsx';
import { storedReadMarks, storeReadMarks } from './read-marks.ts';
import { ReviewTray } from './review-tray.tsx';
import { type RoutesLanding, RoutesScreen } from './routes-screen.tsx';
import { LastSaidOnPage, RespondingOnPage, withResolveToggled } from './said-before.tsx';
import { type SchemaLanding, SchemaScreen } from './schema-screen.tsx';
import {
  CHANGES_ONLY,
  changedSinceIn,
  changedSinceShown,
  drawnAt,
  edgesSaidInPlace,
  LOGIC_ONLY,
  placeOfFile,
  scopesOf,
  stillReadIn,
  unmergedWith,
  viewToShow,
} from './scopes.ts';
import { partFrom, SidePanel } from './side-panel.tsx';
import { TestsScreen } from './tests-screen.tsx';
import { holdsRow } from './what-changed.tsx';

const NOTHING_EXPANDABLE: ReadonlySet<string> = new Set();

export const endsOf = (range: string) => {
  const at = range.indexOf('..');
  return { from: range.slice(0, at), to: range.slice(at + 2) };
};

const NO_CARDS: ReadonlyMap<string, LogicCard> = new Map();

const toggled = (set: ReadonlySet<string>, id: string) =>
  set.has(id) ? new Set([...set].filter(other => other !== id)) : new Set([...set, id]);

export type ReviewPageProps = {
  readonly review: PageData;
  readonly notes?: ReviewNotes | undefined;
  readonly send?: ((review: Review) => Promise<void>) | undefined;
};

const withAnswer = (answers: Answers, id: string, given: Answer | undefined): Answers =>
  given
    ? { ...answers, [id]: given }
    : Object.fromEntries(Object.entries(answers).filter(([answered]) => answered !== id));

const typesText = (target: EventTarget | null) =>
  target instanceof HTMLTextAreaElement ||
  (target instanceof HTMLInputElement && target.type === 'text');

type OtherScreenProps = {
  readonly tab: Tab;
  readonly review: PageData;
  readonly notes: ReviewPageProps['notes'];
  readonly selected: DiffNode | undefined;
  readonly onGoTo: (id: string) => void;
  readonly schemaLanding: SchemaLanding | undefined;
  readonly onSchemaLanded: () => void;
  readonly routesLanding: RoutesLanding | undefined;
  readonly onRoutesLanded: () => void;
  readonly onShowPatch: (path: string, opener: HTMLButtonElement) => void;
  readonly commentAsked: CommentAskedOn | undefined;
};

const OtherScreen = ({
  tab,
  commentAsked,
  review,
  notes,
  selected,
  onGoTo,
  schemaLanding,
  onSchemaLanded,
  routesLanding,
  onRoutesLanded,
  onShowPatch,
}: OtherScreenProps) => (
  <>
    {tab === 'tests' && (
      <CommentAsked.Provider
        value={
          commentAsked?.row === undefined
            ? undefined
            : { anchor: commentAsked.row, request: commentAsked }
        }
      >
        <TestsScreen review={review} notes={notes} selected={selected} onGoTo={onGoTo} />
      </CommentAsked.Provider>
    )}
    {tab === 'schema' && (
      <SchemaScreen review={review} landing={schemaLanding} onLanded={onSchemaLanded} />
    )}
    {tab === 'routes' && (
      <RoutesScreen
        review={review}
        landing={routesLanding}
        onLanded={onRoutesLanded}
        onShowPatch={onShowPatch}
      />
    )}
  </>
);

const notesIn = (notes: ReviewPageProps['notes']) => notesOnTheGraph(notes?.notes ?? {});

const reviewedIn = ({ range, pullRequest }: PageData) => ({
  range,
  ...(pullRequest && { pullRequest: pullRequest.number }),
});

const rowCommentedFrom = (target: EventTarget | null): string | undefined =>
  target instanceof Element
    ? (target.closest('[data-comment-anchor]')?.getAttribute('data-comment-anchor') ?? undefined)
    : undefined;

const useCommentAsked = (selected: string | undefined, tab: Tab) => {
  const [asked, setAsked] = useState<CommentAskedOn & { readonly tab: Tab }>();
  if (asked !== undefined && (asked.on !== selected || asked.tab !== tab)) setAsked(undefined);
  return [asked, (on: CommentAskedOn) => setAsked({ ...on, tab })] as const;
};

type RowNotesOfPageProps = {
  readonly notes: ReviewPageProps['notes'];
  readonly comment: ((written: Comment) => void) | undefined;
  readonly selected: string | undefined;
  readonly onAsk: (asked: CommentAskedOn) => void;
  readonly children: ReactNode;
};

const RowNotesOfPage = ({ notes, comment, selected, onAsk, children }: RowNotesOfPageProps) => {
  const onTake =
    comment &&
    ((anchor: Comment['anchor'], text: string) => {
      comment({ anchor, kind: 'change', text });
      onAsk({ on: selected, row: anchorKey(anchor) });
    });
  return <RowNotes value={{ notes: notes?.notes ?? {}, onTake }}>{children}</RowNotes>;
};

const Page = ({ review, notes, send }: ReviewPageProps) => {
  const tab = useTab(review);
  const [layout, setLayout] = useState<Layout>();
  const [reading, setReading] = useState(false);
  const [selected, setSelected] = useState<string>();
  const { frameElement, placed, frameProps, zoomAtCentre, fitToFrame, centre, pin } = useGraphView(
    layout,
    reading,
    selected,
  );
  const [commentAsked, setCommentAsked] = useCommentAsked(selected, tab);
  const heading = useRef<HTMLHeadingElement>(null);
  const [outside, setOutside] = useState(false);
  const outsideOpener = useRef<HTMLButtonElement>(null);
  const select = (id: string | undefined) => {
    setOutside(false);
    setSelected(id);
  };
  const [comments, setComments] = useState<Comments>({});
  const [answers, setAnswers] = useState<Answers>({});
  const [resolved, setResolved] = useState<ReadonlyArray<PreviousComment>>([]);
  const answer: AnswerTo | undefined =
    send && ((id, given) => setAnswers(current => withAnswer(current, id, given)));
  const [chosenWidth, setChosenWidth] = useState<number>();
  const comment =
    send &&
    ((written: Comment) =>
      setComments(current => ({ ...current, [anchorKey(written.anchor)]: written })));
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const expandable = useMemo(
    () => new Set(review.diff.nodes.flatMap(node => node.parent ?? [])),
    [review],
  );
  const [allEdges, setAllEdges] = useState(false);
  const noted = useMemo(() => new Set(Object.keys(notesIn(notes))), [notes]);
  const scopes = useMemo(() => scopesOf(review), [review]);
  const [scope, setScope] = useState(CHANGES_ONLY);
  const boxesAllOpen = scope[0] === LOGIC_ONLY;
  const placedAt = boxesAllOpen ? expandable : expanded;
  const visible = useMemo(
    () => visibleDiff({ diff: review.diff, expanded: placedAt }),
    [review, placedAt],
  );
  const [cardDepth, setCardDepth] = useState<CardDepth>('decisions');
  const [openedCards, setOpenedCards] = useState<ReadonlySet<string>>(new Set());
  const cards = useMemo(
    () =>
      boxesAllOpen
        ? logicCardsOf({
            files: review.symbols,
            nodes: review.diff.nodes,
            patches: review.patches,
            depth: cardDepth,
            opened: openedCards,
          })
        : NO_CARDS,
    [review, boxesAllOpen, cardDepth, openedCards],
  );
  const [colouring, setColouring] = useState<Colouring>('change');
  const [picked, setPicked] = useState<Lens>();
  const [railOpen, setRailOpen] = useState(false);
  const [startHereOpened, setStartHereOpened] = useState<StartHereOpened>({
    look: true,
    information: false,
  });
  const findings = findingsOf({ data: review, notes });
  const inLens = findings.filter(
    finding => picked === undefined || LENS_OF[finding.dimension] === picked,
  );
  const since = changedSinceShown(scope, review);
  const unmerged = useMemo(() => unmergedWith(noted, since), [noted, since]);
  const drawn = useMemo(() => {
    const [, keep] = scope;
    const atExpansion = drawnAt({
      diff: review.diff,
      expanded,
      noted: unmerged,
      allEdges,
    });
    return keep({ diff: review.diff, expanded, drawn: atExpansion });
  }, [review, expanded, unmerged, allEdges, scope]);
  const shown = useMemo(
    () => visibleNotes({ diff: review.diff, expanded: placedAt, notes: notesIn(notes) }),
    [review, notes, placedAt],
  );
  const toggle = (id: string) => {
    pin(id);
    setExpanded(current => toggled(current, id));
  };
  const elements = useRef(new Map<string, SVGElement | null>());
  const register = (id: string, element: SVGElement | null) => {
    elements.current.set(id, element);
  };
  const labelOf = new Map(visible.nodes.map(node => [node.id, node.label]));
  const dangling = review.dangling;
  const visibleOf = visibleNodeOf({ diff: review.diff, expanded: placedAt });
  const boxesAbove = boxesAboveIn(review.diff.nodes);
  const placedFindings = findingsAt({ diff: review.diff, expanded: placedAt, findings });
  const numbers = new Map(review.readingOrder.parts.map((part, index) => [part, index + 1]));
  const drawing = {
    findingsOn: (id: string) => placedFindings.get(id) ?? [],
    numberOf: (id: string) => numbers.get(id),
    picked,
    notes: shown,
    onSelect: (id: string) => (reading ? goTo(id) : select(id)),
    register,
    expandable: reading || boxesAllOpen ? NOTHING_EXPANDABLE : expandable,
    expanded,
    onToggle: toggle,
    inMap: reading,
    current: reading ? selected : undefined,
    scale: placed?.view.scale ?? 1,
    cards,
    onTick: (node: string, decision: string) =>
      goToRow(node, anchorKey({ kind: 'decision', id: decision })),
    openedCards,
    onOpenCard: (node: string) => setOpenedCards(current => toggled(current, node)),
    unroutedOf: (id: string) =>
      dangling.filter(call => visibleOf(call.from) === id).map(call => call.path),
    shadeOf: ({ id, state }: DiffedNode) => {
      const inside = review.symbols.filter(
        file => file.node === id || boxesAbove(file.node).includes(id),
      );
      const kinds = inside.flatMap(file => ('kind' in file ? [file.kind] : []));
      return shadeOf(colouring, {
        metrics: review.metrics[id],
        changed: state !== 'unchanged',
        decisions:
          state === 'modified' && kinds.length > 0 ? logicTotalsOf(inside).decisions : undefined,
        kinds,
      });
    },
  };
  const selectedNode = review.diff.nodes.find(node => node.id === selected);
  const selectedNote = selected === undefined ? undefined : shown[selected];
  const selectedFindings = selected === undefined ? [] : drawing.findingsOn(selected);
  const graphLeft = () => frameElement?.getBoundingClientRect().left ?? 0;
  const showOutside = (opener: HTMLButtonElement) => {
    outsideOpener.current = opener;
    setSelected(undefined);
    setOutside(true);
  };
  const closeOutside = () => {
    const opener = outsideOpener.current;
    (!reading && opener?.isConnected ? opener : frameElement)?.focus();
    setOutside(false);
    setReading(false);
  };
  const closeInspector = (id: string) => {
    if (reading) setFocusTarget({ id, inGraph: true });
    else elements.current.get(id)?.focus({ preventScroll: true });
    select(undefined);
    setReading(false);
  };

  const [focusTarget, setFocusTarget] = useState<{
    readonly id: string;
    readonly inGraph: boolean;
  }>();
  const goTo = (id: string) => {
    select(id);
    const showing = viewToShow({ diff: review.diff, expanded, noted, allEdges, scopes, scope, id });
    setExpanded(showing.expanded);
    if (showing.allEdges) setAllEdges(true);
    setScope(showing.scope);
    centre(id);
    setFocusTarget({ id, inGraph: true });
  };
  const goToOnStructure = (id: string) => {
    location.hash = '#structure';
    goTo(id);
  };
  const [landing, landOn] = useLanding(outside ? null : selected);
  const goToDraft = (id: string, anchor: PreviousComment['anchor']) => {
    const onRow =
      anchor.kind === 'finding'
        ? findings.some(finding => finding.id === anchor.id)
        : holdsRow(review, anchor);
    const place = onRow ? { path: undefined, row: anchorKey(anchor) } : placeOfLine(anchor);
    landOn(id, place ?? { path: undefined });
    goToOnStructure(id);
    if (onRow) setFocusTarget({ id, inGraph: false });
  };
  const goToRow = (id: string, row: string) => {
    landOn(id, { path: undefined, row });
    goTo(id);
  };
  const goToFinding = (id: string, finding: string) => {
    const flagged = anchorOfNoteFlag(finding);
    if (flagged?.kind !== 'line') return goToRow(id, rowOfFinding(finding));
    landOn(id, lineAt(flagged.id));
    goTo(id);
  };
  const showOutsideAt = (place: LandingIn, opener: HTMLButtonElement) => {
    landOn(null, place);
    location.hash = '#structure';
    showOutside(opener);
  };
  const [schemaLanding, setSchemaLanding] = useState<SchemaLanding>();
  const [routesLanding, setRoutesLanding] = useState<RoutesLanding>();
  const showPatch = (path: string, opener: HTMLButtonElement, line?: string) => {
    const place = line === undefined ? { path } : lineAt(line);
    const holder = deepestHolding(path, review.diff.nodes);
    if (holder === undefined) {
      showOutsideAt(place, opener);
      return;
    }
    landOn(holder.id, place);
    goToOnStructure(holder.id);
  };
  const showFile = (path: string, opener: HTMLButtonElement, place: PlaceInFile) => {
    const shown = placeOfFile(review, path, place);
    if (shown.to === 'schema') {
      setSchemaLanding({ file: path, table: shown.table });
      location.hash = '#schema';
    } else if (shown.to === 'routes') {
      setRoutesLanding({ file: path, route: shown.route });
      location.hash = '#routes';
    } else showPatch(path, opener, shown.line);
  };
  const [read, setRead] = useState(() => storedReadMarks(review.range, stillReadIn(review)));
  useEffect(() => storeReadMarks(review.range, read), [review.range, read]);
  const toggleRead = (id: string) => setRead(current => toggled(current, id));
  const walkTo = (id: string) => {
    setReading(true);
    goTo(id);
  };
  const walk = (step: number) => {
    const { parts } = review.readingOrder;
    const next = parts.includes(selected ?? '')
      ? (partFrom(parts, selected, step) ?? selected)
      : (parts.find(part => !read.has(part)) ?? parts[0]);
    if (next !== undefined) walkTo(next);
  };
  const logicWalk = useMemo(
    () => walkOfDecisions({ files: review.symbols, parts: review.readingOrder.parts }),
    [review.symbols, review.readingOrder.parts],
  );
  const nextLogic = nextDecision({ walk: logicWalk, selected, row: landing?.row });
  const walkLogic =
    nextLogic &&
    (() => {
      setReading(true);
      goToRow(nextLogic.node, nextLogic.row);
      setFocusTarget({ id: nextLogic.node, inGraph: false });
    });
  const openMap = () => {
    setReading(false);
    if (selected === undefined) frameElement?.focus();
    else setFocusTarget({ id: selected, inGraph: true });
  };
  const showAllFindings = () => {
    openMap();
    setPicked(undefined);
    setRailOpen(true);
  };
  useEffect(() => {
    if (tab !== 'structure') return;
    const keyed = (event: globalThis.KeyboardEvent) => {
      if (typesText(event.target)) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === 'escape' && reading) openMap();
      if (key === 'j') walk(1);
      if (key === 'k') walk(-1);
      if (key === 'l') walkLogic?.();
      if (key === 'c' && selected !== undefined) {
        event.preventDefault();
        setCommentAsked({ on: selected, row: rowCommentedFrom(event.target) });
      }
      if (key === 'a' && selected !== undefined && review.readingOrder.parts.includes(selected))
        toggleRead(selected);
    };
    document.addEventListener('keydown', keyed);
    return () => document.removeEventListener('keydown', keyed);
  });
  useEffect(() => {
    layoutDiff(drawn, { sizes: cards }).then(setLayout);
  }, [drawn, cards]);
  useEffect(() => {
    if (focusTarget === undefined || tab !== 'structure') return;
    if (reading) {
      if (focusTarget.inGraph) heading.current?.focus({ preventScroll: landing !== undefined });
      setFocusTarget(undefined);
      return;
    }
    if (layout === undefined) return;
    const element = elements.current.get(focusTarget.id);
    if (element) {
      if (focusTarget.inGraph && !typesText(document.activeElement))
        element.focus({ preventScroll: true });
      frameElement?.scrollIntoView({ block: 'nearest' });
      setFocusTarget(undefined);
    }
  }, [layout, focusTarget, frameElement, reading, landing, tab]);
  const content = (
    <div key="content" className="content">
      {!reading && (
        <GraphHead
          review={review}
          notes={notes}
          findings={findings}
          inLens={inLens}
          picked={picked}
          onPick={setPicked}
          onShowAll={() => setRailOpen(true)}
          startHereOpened={startHereOpened}
          onStartHereOpened={setStartHereOpened}
          onGoTo={goTo}
          onGoToFinding={goToFinding}
          onShowOutside={showOutside}
          onShowFile={showFile}
          cardDepth={cardDepth}
          onCardDepth={next => {
            fitToFrame();
            setCardDepth(next);
            setOpenedCards(new Set());
          }}
          colouring={colouring}
          onColouring={setColouring}
          scopes={scopes}
          scope={scope}
          onScope={next => {
            fitToFrame();
            setScope(next);
          }}
          allEdges={allEdges}
          onAllEdges={next => {
            fitToFrame();
            setAllEdges(next);
          }}
          since={since}
          nothingDrawn={drawn.nodes.length === 0}
        />
      )}
      {layout && (
        <GraphFrame
          layout={layout}
          placed={placed}
          frameProps={frameProps}
          reading={reading}
          drawing={drawing}
          colouring={colouring}
          range={review.range}
          labelOf={labelOf}
          onOpenMap={openMap}
          onZoom={zoomAtCentre}
          onFit={fitToFrame}
        />
      )}
      {reading && (
        <ReadingFoot
          diff={review.diff}
          part={selectedNode?.id}
          read={read}
          anyFindings={findings.length > 0}
          onGoTo={goTo}
          onShowAllFindings={showAllFindings}
        />
      )}
    </div>
  );
  const side = (
    <SidePanel
      key="side"
      review={review}
      selected={selected}
      node={selectedNode}
      outside={outside}
      note={selectedNote}
      found={selectedFindings}
      saidInPlace={edgesSaidInPlace({
        comments: review.sinceReview?.comments ?? [],
        arrow: selected,
        diff: review.diff,
        expanded: placedAt,
        noted: unmerged,
        allEdges,
      })}
      answers={answers}
      onAnswer={answer}
      chosenWidth={chosenWidth}
      onChooseWidth={setChosenWidth}
      graphLeft={graphLeft}
      onCloseOutside={closeOutside}
      onCloseInspector={closeInspector}
      onGoTo={goTo}
      onWalkTo={walkTo}
      onNextLogic={walkLogic}
      landing={landing}
      onLand={line => landOn(selected, line)}
      read={read}
      onToggleRead={toggleRead}
      commentAsked={commentAsked}
      onAskComment={id => setCommentAsked({ on: id, row: undefined })}
      heading={heading}
      reading={reading}
    />
  );
  const page = (
    <main>
      <Header review={review} tab={tab} read={read} />
      {tab === 'structure' && (
        <>
          {!reading && review.diff.edges.some(edge => edge.via !== undefined) && (
            <div className="structure-head">
              <p className="caveat">Calls whose path is built at runtime are not drawn.</p>
            </div>
          )}
          <div className={reading ? 'columns reading' : 'columns'}>
            <LeftColumn
              review={review}
              notes={notes}
              reading={reading}
              read={read}
              selected={selected}
              commentable={send !== undefined}
              findings={findings}
              inLens={inLens}
              railOpen={railOpen}
              onRailOpen={setRailOpen}
              answers={answers}
              onAnswer={answer}
              onGoTo={goTo}
              onWalkTo={walkTo}
              onStart={() => walk(1)}
              onGoToDraft={goToDraft}
              onGoToFinding={goToFinding}
              onGoToOutside={showOutsideAt}
              onShowOutside={showOutside}
              onShowFile={showFile}
            />
            {reading ? [side, content] : [content, side]}
          </div>
        </>
      )}
      <OtherScreen
        tab={tab}
        review={review}
        notes={notes}
        selected={selectedNode}
        onGoTo={goToOnStructure}
        schemaLanding={schemaLanding}
        onSchemaLanded={() => setSchemaLanding(undefined)}
        routesLanding={routesLanding}
        onRoutesLanded={() => setRoutesLanding(undefined)}
        onShowPatch={showPatch}
        commentAsked={commentAsked}
      />
      {send && (
        <ReviewTray
          reviewed={reviewedIn(review)}
          read={review.readingOrder.parts.filter(part => read.has(part))}
          resolved={resolved}
          parts={review.readingOrder.parts}
          comments={comments}
          answers={answers}
          findings={findings}
          nodes={review.diff.nodes}
          tests={review.tests}
          onGoToDraft={goToDraft}
          onGoToOutside={showOutsideAt}
          onGoToFile={showFile}
          send={send}
        />
      )}
    </main>
  );
  return (
    <Drafting.Provider value={{ comments, onComment: comment }}>
      <ChangedSinceMarks value={changedSinceIn(review)}>
        <RespondingOnPage
          value={
            comment && {
              resolved,
              onResolve: said => setResolved(current => withResolveToggled(current, said)),
            }
          }
        >
          <RowNotesOfPage
            notes={notes}
            comment={comment}
            selected={selected}
            onAsk={setCommentAsked}
          >
            {page}
          </RowNotesOfPage>
        </RespondingOnPage>
      </ChangedSinceMarks>
    </Drafting.Provider>
  );
};

export const ReviewPage = (props: ReviewPageProps) => (
  <LastSaidOnPage since={props.review.sinceReview} answers={props.notes?.answers}>
    <Page {...props} />
  </LastSaidOnPage>
);
