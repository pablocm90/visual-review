import {
  type ReactNode,
  type RefObject,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { anchorKey, anchorOfKey, fileOfLine } from '../core/anchors.ts';
import type { FilePatch, GraphDiff } from '../core/diff-graphs.ts';
import { anchorOfNoteFlag, type Finding } from '../core/findings.ts';
import { stackOfIn } from '../core/graph.ts';
import type { MetricFinding } from '../core/metric-findings.ts';
import type { NodeMetrics } from '../core/metrics.ts';
import type { Note } from '../core/notes.ts';
import { isReachFinding } from '../core/reach-findings.ts';
import type { Reach } from '../core/read-reaches.ts';
import type { SymbolFile } from '../core/reading.ts';
import type { Comment } from '../core/review.ts';
import type { TestFile } from '../core/test-changes.ts';
import { testsAlongside } from '../core/tests-alongside.ts';
import { boxesAboveIn } from '../core/visible-diff.ts';
import { anchorName, placeOfLine } from './anchors.ts';
import { ChangedSinceTag, useIsChangedSince } from './changed-since.tsx';
import { type Comments, holdsDraft, useDrafting } from './comment-field.tsx';
import type { Answers, AnswerTo } from './finding-display.tsx';
import { FindingRows, type FindingRowsProps } from './finding-rows.tsx';
import { highlightPatch } from './highlight-patch.ts';
import { MetricsTable } from './metrics-tab.tsx';
import { NoteBlock, RowNotes } from './note-block.tsx';
import {
  type LineLanding,
  type PatchPlaces,
  PatchRows,
  rowLandedOn,
  useSaidAt,
} from './patch-rows.tsx';
import { Reaches } from './reaches.tsx';
import {
  CommentFieldUnlessSaid,
  CommentOn,
  SaidBefore,
  useHasSaid,
  useSaidLinesOf,
} from './said-before.tsx';
import { scrollInPanel } from './scroll-in-panel.ts';
import { TestedBy, useTestsToRead } from './tests-screen.tsx';
import {
  LandedRows,
  type LineAt,
  type RowLanding,
  useFilesWithNews,
  WhatChanged,
} from './what-changed.tsx';

export type LandingIn = Partial<LineLanding> & { readonly path: string | undefined } & RowLanding;

const onThePart = (landing: LandingIn | undefined) =>
  landing?.path === undefined && landing?.row === undefined ? landing : undefined;

const holdsLineDraft = (comments: Comments, path: string) =>
  Object.values(comments).some(({ anchor }) => placeOfLine(anchor)?.path === path);

const useHoldsLineNote = () => {
  const { notes } = useContext(RowNotes);
  return (path: string) =>
    Object.keys(notes).some(key => {
      const { kind, id } = anchorOfKey(key);
      return kind === 'line' && fileOfLine(id) === path;
    });
};

const Patch = ({
  path,
  patch,
  open,
  landing,
  ...commenting
}: FilePatch &
  PatchPlaces & { readonly open: boolean; readonly landing: LandingIn | undefined }) => {
  const lines = useMemo(() => highlightPatch({ path, patch }), [path, patch]);
  const marked = useIsChangedSince()('files', path);
  const saidLines = useSaidLinesOf(path);
  const saidAt = useSaidAt(path, lines);
  const landed = landing?.path === path ? landing : undefined;
  const landedRow = landed && rowLandedOn({ lines, path, landing: landed });
  const top = useRef<HTMLDetailsElement>(null);
  useLayoutEffect(() => {
    if (!top.current || landed === undefined) return;
    top.current.open = true;
    const row = top.current.querySelector<HTMLElement>('[aria-current]');
    if (row) scrollInPanel(row, 'center');
    else scrollInPanel(top.current, 'start');
  }, [landed]);
  const holdsDraft = holdsLineDraft(useDrafting().comments, path);
  const holdsNote = useHoldsLineNote()(path);
  return (
    <details
      aria-label={path}
      open={open || holdsDraft || holdsNote || saidLines.length > 0}
      ref={top}
    >
      <summary>
        {path}
        <ChangedSinceTag marked={marked} />
      </summary>
      {saidAt(undefined).map(on => (
        <SaidBefore key={on.id} on={on} landing={landed} />
      ))}
      <PatchRows
        path={path}
        lines={lines}
        saidAt={saidAt}
        landedRow={landedRow}
        landed={landed}
        {...commenting}
      />
    </details>
  );
};

export type DiffNode = GraphDiff['nodes'][number];

const stackOf = (nodes: ReadonlyArray<DiffNode>, node: DiffNode): DiffNode => {
  const stack = stackOfIn(nodes)(node.id);
  return nodes.find(({ id }) => id === stack) ?? node;
};

type Walking = {
  readonly read: boolean | undefined;
  readonly onToggleRead: () => void;
  readonly next: DiffNode | undefined;
  readonly onGoTo: (id: string) => void;
  readonly onNextLogic: (() => void) | undefined;
};

const KeyHint = ({ letter }: { readonly letter: string }) => (
  <span aria-hidden="true">
    <kbd>{letter}</kbd>
  </span>
);

const InspectorHead = ({
  nodes,
  node,
  walking: { read, onToggleRead, next, onGoTo, onNextLogic },
  anchor,
  landing,
  heading,
}: {
  readonly heading: RefObject<HTMLHeadingElement | null>;
  readonly nodes: ReadonlyArray<DiffNode>;
  readonly node: DiffNode;
  readonly walking: Walking;
  readonly anchor: Comment['anchor'];
  readonly landing: LandingIn | undefined;
}) => (
  <header className="inspector-head">
    <p className="chips">
      <span>
        {node.kind} · {stackOf(nodes, node).label}
      </span>
      <span data-state={node.state}>{node.state}</span>
    </p>
    <h2 ref={heading} tabIndex={-1}>
      {node.label}
    </h2>
    <p className="path">
      {node.renamedFrom === undefined
        ? node.path
        : `${node.path}, renamed from ${node.renamedFrom}`}
    </p>
    <div className="part-actions">
      <CommentOn
        key={node.id}
        anchor={anchor}
        name={node.label}
        word={
          <>
            Comment <KeyHint letter="C" />
          </>
        }
        landing={onThePart(landing)}
      />
      {read !== undefined && (
        <button type="button" aria-pressed={read} onClick={onToggleRead}>
          Mark read <KeyHint letter="A" />
        </button>
      )}
      {next && (
        <button type="button" onClick={() => onGoTo(next.id)}>
          Next: {next.label} <KeyHint letter="J" />
        </button>
      )}
      {onNextLogic && (
        <button type="button" className="next-logic" onClick={onNextLogic}>
          Next logic change <KeyHint letter="L" />
        </button>
      )}
    </div>
  </header>
);

type InspectorProps = {
  readonly reviewPatches: ReadonlyArray<FilePatch>;
  readonly landing: LandingIn | undefined;
  readonly onLand: (landing: LandingIn) => void;
  readonly nodes: ReadonlyArray<DiffNode>;
  readonly node: DiffNode | undefined;
  readonly metrics: Readonly<Record<string, NodeMetrics>>;
  readonly findings: ReadonlyArray<MetricFinding>;
  readonly note: Note | undefined;
  readonly found: ReadonlyArray<Finding>;
  readonly patches: ReadonlyArray<FilePatch>;
  readonly tests: ReadonlyArray<TestFile>;
  readonly symbols: ReadonlyArray<SymbolFile>;
  readonly reaches: ReadonlyArray<Reach>;
  readonly onGoTo: (id: string) => void;
  readonly anchor: Comment['anchor'];
  readonly commentable: boolean;
  readonly onTake: ((recommendation: string) => void) | undefined;
  readonly saidInPlace: ReadonlyArray<string>;
  readonly answers: Answers;
  readonly onAnswer: AnswerTo | undefined;
  readonly width: number | undefined;
  readonly onClose: () => void;
  readonly walking: Walking;
  readonly heading: RefObject<HTMLHeadingElement | null>;
};

type LandingPlace = string | null | undefined;

export const rowOfFinding = (finding: string): string => {
  const flagged = anchorOfNoteFlag(finding);
  return flagged === undefined || flagged.kind === 'part' || flagged.kind === 'edge'
    ? anchorKey({ kind: 'finding', id: finding })
    : anchorKey(flagged);
};

export type CommentAskedOn = { readonly on: string | undefined; readonly row: string | undefined };

export const useLanding = (place: LandingPlace) => {
  const [landed, setLanded] = useState<LandingIn & { readonly on: LandingPlace }>();
  if (landed !== undefined && landed.on !== place) setLanded(undefined);
  return [landed, (on: LandingPlace, landing: LandingIn) => setLanded({ ...landing, on })] as const;
};

type FoldProps = {
  readonly title: string;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly children: ReactNode;
};

const Fold = ({ title, open, onToggle, children }: FoldProps) => (
  <section className="fold" aria-label={title}>
    <button type="button" className="fold-toggle" aria-expanded={open} onClick={onToggle}>
      {title}
    </button>
    {open && children}
  </section>
);

type FullDiffProps = PatchPlaces & {
  readonly patches: ReadonlyArray<FilePatch>;
  readonly patchesOpen: boolean;
  readonly held: boolean;
  readonly onHold: (held: boolean) => void;
  readonly landing: LandingIn | undefined;
};

const FullDiff = ({
  patches,
  patchesOpen,
  held,
  onHold,
  landing,
  ...commenting
}: FullDiffProps) => {
  const [closedAt, setClosedAt] = useState<{ readonly landing: LandingIn | undefined }>();
  const [landedOn, setLandedOn] = useState(false);
  const holdsLineNote = useHoldsLineNote();
  const { comments } = useDrafting();
  const onAPatch = landing?.path === undefined ? undefined : landing;
  if (onAPatch !== undefined && !landedOn) setLandedOn(true);
  const wanted =
    onAPatch !== undefined ||
    landedOn ||
    patches.some(({ path }) => holdsLineDraft(comments, path) || holdsLineNote(path));
  const closed =
    closedAt !== undefined && (onAPatch === undefined || closedAt.landing === onAPatch);
  const open = (held || wanted) && !closed;
  return (
    <Fold
      title="Full diff"
      open={open}
      onToggle={() => {
        onHold(!open);
        setClosedAt(open ? { landing: onAPatch } : undefined);
      }}
    >
      <section className="changes" aria-label="Changes">
        {patches.map(patch => (
          <Patch key={patch.path} {...patch} open={patchesOpen} landing={landing} {...commenting} />
        ))}
      </section>
    </Fold>
  );
};

type NotePanelProps = Pick<
  InspectorProps,
  | 'nodes'
  | 'node'
  | 'symbols'
  | 'reaches'
  | 'tests'
  | 'onGoTo'
  | 'note'
  | 'found'
  | 'anchor'
  | 'commentable'
  | 'onTake'
  | 'saidInPlace'
  | 'answers'
  | 'onAnswer'
  | 'landing'
  | 'reviewPatches'
> & {
  readonly onShowLine: (at: LineAt) => void;
  readonly onShowRow: (row: string) => void;
};

const WhyLook = (rows: FindingRowsProps) => (
  <section className="column-section" aria-label="Why look">
    <h3>Why look</h3>
    <FindingRows {...rows} />
  </section>
);

const isUntestedLogic = ({ check }: Finding) => check === 'tests:untested-logic';

/** Information What changed already says, row by row: an export added, a function's logic changed. */
const SAID_IN_WHAT_CHANGED: ReadonlySet<Finding['check']> = new Set(['api:added', 'logic:changed']);

const isShownInWhatChanged = ({ check, level }: Finding) =>
  level === 'info' && SAID_IN_WHAT_CHANGED.has(check);

const NotePanel = ({
  nodes,
  node,
  reviewPatches,
  symbols,
  reaches,
  tests,
  onGoTo,
  onShowLine,
  onShowRow,
  landing,
  note,
  found,
  anchor,
  commentable,
  onTake,
  saidInPlace,
  answers,
  onAnswer,
}: NotePanelProps) => {
  const filesWithNews = useFilesWithNews(node, symbols, nodes);
  const hasSaid = useHasSaid();
  const { comments, onComment } = useDrafting();
  const testsToRead = useTestsToRead(node ? testsAlongside({ nodes, node, tests }) : []);
  const boxesAbove = boxesAboveIn(nodes);
  const reachesHere = node
    ? reaches.filter(reach => reach.node === node.id || boxesAbove(reach.node).includes(node.id))
    : [];
  const untested = found.filter(isUntestedLogic);
  const toLookAt = found.filter(
    finding =>
      !isUntestedLogic(finding) &&
      !isReachFinding(finding) &&
      !(filesWithNews.length > 0 && isShownInWhatChanged(finding)),
  );
  const isBare =
    filesWithNews.length === 0 &&
    found.length === 0 &&
    testsToRead.length === 0 &&
    reachesHere.length === 0 &&
    !hasSaid(anchor) &&
    saidInPlace.length === 0;
  const shownNote = note ?? (isBare ? { text: 'No note' } : undefined);
  const drafted = holdsDraft(comments, anchor);
  return (
    <LandedRows landing={landing}>
      {shownNote !== undefined && (
        <NoteBlock note={shownNote} onTake={drafted ? undefined : onTake} />
      )}
      <SaidBefore key={anchorKey(anchor)} on={anchor} landing={onThePart(landing)} />
      {saidInPlace.map(id => (
        <div key={id}>
          <p className="said-edge">{anchorName({ kind: 'edge', id }, nodes)}</p>
          <SaidBefore on={{ kind: 'edge', id }} />
        </div>
      ))}
      {onComment &&
        !node &&
        (commentable ? (
          <CommentFieldUnlessSaid anchor={anchor} />
        ) : (
          <p>Drawn for several edges: open its ends to comment on one of them.</p>
        ))}
      {toLookAt.length > 0 && <WhyLook found={toLookAt} answers={answers} onAnswer={onAnswer} />}
      {node && filesWithNews.length > 0 && (
        <WhatChanged
          node={node}
          files={filesWithNews}
          nodes={nodes}
          patches={reviewPatches}
          allFiles={symbols}
          onGoTo={onGoTo}
          onShowLine={onShowLine}
          onShowRow={onShowRow}
        />
      )}
      {(testsToRead.length > 0 || untested.length > 0) && (
        <TestedBy
          drawn={testsToRead}
          nodes={nodes}
          found={untested}
          answers={answers}
          onAnswer={onAnswer}
        />
      )}
      {reachesHere.length > 0 && (
        <Reaches
          reaches={reachesHere}
          nodes={nodes}
          onGoTo={onGoTo}
          found={found}
          answers={answers}
          onAnswer={onAnswer}
        />
      )}
    </LandedRows>
  );
};

export const Inspector = ({
  node,
  patches,
  width,
  onClose,
  landing,
  onLand,
  walking,
  heading,
  ...props
}: InspectorProps) => {
  const showLine = ({ node: at, ...line }: LineAt) =>
    onLand({ ...line, path: props.nodes.find(({ id }) => id === at)?.path });
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [diffHeld, setDiffHeld] = useState(false);
  const measured = node && props.metrics[node.id];
  const column = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const head = column.current?.querySelector<HTMLElement>('.inspector-head');
    if (!column.current || !head) return;
    const held = column.current;
    const measure = () =>
      held.style.setProperty('--inspector-head', `${head.getBoundingClientRect().height}px`);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(head);
    return () => observer.disconnect();
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new part opens at the column's top
  useLayoutEffect(() => {
    if (!column.current || landing?.row !== undefined || landing?.path !== undefined) return;
    column.current.scrollTop = 0;
  }, [props.anchor.id, landing]);
  return (
    <aside ref={column} className="note" aria-label="Inspector" style={{ width }}>
      <button type="button" className="close" aria-label="Close inspector" onClick={onClose}>
        ×
      </button>
      {node && (
        <InspectorHead
          heading={heading}
          nodes={props.nodes}
          node={node}
          walking={walking}
          anchor={props.anchor}
          landing={landing}
        />
      )}
      <NotePanel
        {...props}
        node={node}
        onShowLine={showLine}
        onShowRow={row => onLand({ path: undefined, row })}
        landing={landing}
      />
      {node && measured && (
        <Fold title="Metrics" open={metricsOpen} onToggle={() => setMetricsOpen(!metricsOpen)}>
          <MetricsTable
            metrics={measured}
            findings={props.findings.filter(finding => finding.node === node.id)}
          />
        </Fold>
      )}
      {patches.length > 0 && (
        <FullDiff
          key={props.anchor.id}
          patches={patches}
          patchesOpen={node?.kind === 'file'}
          held={diffHeld}
          onHold={setDiffHeld}
          landing={landing}
          nodes={props.nodes}
        />
      )}
    </aside>
  );
};

type OutsideFilesProps = PatchPlaces & {
  readonly patches: ReadonlyArray<FilePatch>;
  readonly landing: LandingIn | undefined;
  readonly width: number | undefined;
  readonly onClose: () => void;
};

export const OutsideFiles = ({
  patches,
  landing,
  width,
  onClose,
  ...commenting
}: OutsideFilesProps) => (
  <aside className="note" aria-label="Inspector" style={{ width }}>
    <button type="button" className="close" aria-label="Close inspector" onClick={onClose}>
      ×
    </button>
    <h2>Changed files outside the graph</h2>
    <section className="changes" aria-label="Changes">
      {patches.map(patch => (
        <Patch key={patch.path} {...patch} open={false} landing={landing} {...commenting} />
      ))}
    </section>
  </aside>
);
