import {
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { anchorKey } from '../core/anchors.ts';
import type { DiffedNode, FilePatch, GraphDiff } from '../core/diff-graphs.ts';
import { deepestHolding, isAtOrUnder } from '../core/diff-graphs.ts';
import { type Finding, findingsAt, findingsOf } from '../core/findings.ts';
import { edgeId } from '../core/graph.ts';
import { type MetricFinding, metricFindings } from '../core/metric-findings.ts';
import type { NodeMetrics } from '../core/metrics.ts';
import { type Note, type ReviewNotes, visibleNotes } from '../core/notes.ts';
import { type PageData, UNCOMMITTED } from '../core/page.ts';
import type { PreviousComment } from '../core/previous-comments.ts';
import type { SymbolFile } from '../core/read-range.ts';
import type { Answer, Comment, Review } from '../core/review.ts';
import type { ChangedSince, SinceReview } from '../core/since-review.ts';
import type { TestFile } from '../core/test-changes.ts';
import { testsAlongside } from '../core/tests-alongside.ts';
import {
  boxesAboveIn,
  changesOnly,
  expandedToShow,
  isDrawn,
  mergedDiff,
  nearChanges,
  sinceLastReview,
  visibleDiff,
  visibleNodeOf,
} from '../core/visible-diff.ts';
import { anchorName, lineAnchor, placeOfLine, rowOfLine } from './anchors.ts';
import { ChangedSinceMarks, ChangedSinceTag, useIsChangedSince } from './changed-since.tsx';
import { ColourBy, type Colouring, ScaleLegend, type Shade, shadeOf } from './colour-by.tsx';
import { CommentAsked, type Comments } from './comment-field.tsx';
import { type Answers, type AnswerTo, findingLine, LEVELS, worstOf } from './finding-display.tsx';
import { FindingRows, type FindingRowsProps } from './finding-rows.tsx';
import { FindingsRail, LensChips, LensRow, StartHere } from './findings-rail.tsx';
import { highlightPatch, type PatchLine as Line, type Piece } from './highlight-patch.ts';
import { LastReview } from './last-review.tsx';
import {
  type Layout,
  layoutDiff,
  type PlacedEdge,
  type PlacedNode,
  type PlacedStack,
} from './layout.ts';
import { LENS_OF, type Lens } from './lenses.ts';
import { MetricsScreen } from './metrics-screen.tsx';
import { MetricsTable } from './metrics-tab.tsx';
import { NextToIt } from './next-to-it.tsx';
import { storedReadMarks, storeReadMarks } from './read-marks.ts';
import { partsRead, ReadingOrderList, ReadingStops } from './reading-order-list.tsx';
import { Ref, shortRef } from './ref.tsx';
import { ReviewTray, verdictLabels } from './review-tray.tsx';
import { type RoutesLanding, RoutesScreen, routesHold } from './routes-screen.tsx';
import {
  CommentFieldUnlessSaid,
  CommentOn,
  LastSaidOnPage,
  RespondingOnPage,
  SaidBefore,
  useHasSaid,
  useSaidLinesOf,
  withResolveToggled,
} from './said-before.tsx';
import { type SchemaLanding, SchemaScreen } from './schema-screen.tsx';
import { scrollInPanel } from './scroll-in-panel.ts';
import { changedCount, TestedBy, TestsScreen, useTestsToRead } from './tests-screen.tsx';
import {
  boxOf,
  centred,
  fitted,
  frameHeight,
  mapHeight,
  panned,
  pinned,
  resized,
  ringAround,
  type Size,
  type View,
  zoomed,
} from './view.ts';
import {
  holdsRow,
  LandedRows,
  type LineAt,
  type RowLanding,
  useFilesWithNews,
  WhatChanged,
} from './what-changed.tsx';

const STATES = ['added', 'removed', 'modified', 'unchanged'] as const;

const NOTHING_EXPANDABLE: ReadonlySet<string> = new Set();

const NOTE_WIDTH = 360;
const CHANGES_WIDTH = 600;
const PANEL_MIN = 280;
const GRAPH_MIN = 320;
const DIVIDER_AND_PADDING = 48;
const DIVIDER_STEP = 40;
const LEAST_DRAG = 4;
const WHEEL_PER_DOUBLING = 100;
const PAN_STEP = 40;

const panelWidthWithin = (width: number, graphLeft: number) =>
  Math.min(
    Math.max(width, PANEL_MIN),
    window.innerWidth - graphLeft - DIVIDER_AND_PADDING - GRAPH_MIN,
  );

const edgePath = (points: PlacedEdge['points']): string =>
  points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');

const pressable = (onPress: () => void) => ({
  onClick: onPress,
  onKeyDown: (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onPress();
    }
  },
});

type SelectableOptions = {
  readonly id: string;
  readonly name: string;
  readonly note: Note | undefined;
  readonly onSelect: (id: string) => void;
  readonly register: (id: string, element: SVGElement | null) => void;
  readonly inMap: boolean;
};

const selectable = ({ id, name, note, onSelect, register, inMap }: SelectableOptions) => ({
  ...pressable(() => onSelect(id)),
  ref: (element: SVGElement | null) => register(id, element),
  role: 'button',
  tabIndex: inMap ? -1 : 0,
  'aria-label': note?.flag ? `${name}, flagged: ${note.flag}` : name,
});

const middleOf = (points: PlacedEdge['points']) => {
  const before = points[Math.floor((points.length - 1) / 2)];
  const after = points[Math.ceil((points.length - 1) / 2)];
  return before && after
    ? { x: (before.x + after.x) / 2, y: (before.y + after.y) / 2 }
    : { x: 0, y: 0 };
};

const badgeName = (findings: ReadonlyArray<Finding>) =>
  `${LEVELS[worstOf(findings)]}, ${findings.length} ${findings.length === 1 ? 'finding' : 'findings'}: ${findings.map(findingLine).join('; ')}`;

type FindingsBadgeProps = {
  readonly x: number;
  readonly y: number;
  readonly findings: ReadonlyArray<Finding>;
  readonly picked: Lens | undefined;
  readonly onPress?: () => void;
};

const FindingsBadge = ({ x, y, findings, picked, onPress }: FindingsBadgeProps) => {
  const outside =
    picked !== undefined && !findings.some(finding => LENS_OF[finding.dimension] === picked);
  const name = `${badgeName(findings)}${outside ? `, outside ${picked}` : ''}`;
  return (
    <g
      className="flag-badge"
      data-level={worstOf(findings)}
      data-outside={outside}
      role="img"
      aria-label={name}
      onClick={onPress}
      transform={`translate(${x} ${y})`}
    >
      <title>{name}</title>
      <circle r={8} />
      <path d="M 0 -4.5 V 1 M 0 3.5 V 4" />
    </g>
  );
};

type ReadingNumberProps = { readonly number: number; readonly x: number };

const ReadingNumber = ({ number, x }: ReadingNumberProps) => (
  <g
    className="reading-badge"
    role="img"
    aria-label={`Reading order ${number}`}
    transform={`translate(${x} 0)`}
  >
    <circle className="reading-badge-disc" r={10} />
    <text className="reading-badge-number">{number}</text>
  </g>
);

type Drawing = {
  readonly findingsOn: (id: string) => ReadonlyArray<Finding>;
  readonly numberOf: (id: string) => number | undefined;
  readonly picked: Lens | undefined;
  readonly notes: Readonly<Record<string, Note>>;
  readonly onSelect: (id: string) => void;
  readonly register: (id: string, element: SVGElement | null) => void;
  readonly expandable: ReadonlySet<string>;
  readonly expanded: ReadonlySet<string>;
  readonly onToggle: (id: string) => void;
  readonly unroutedOf: (id: string) => ReadonlyArray<string>;
  readonly shadeOf: (node: DiffedNode) => Shade | undefined;
  readonly inMap: boolean;
  readonly current: string | undefined;
  readonly scale: number;
};

type CurrentRingProps = {
  readonly node: PlacedNode;
  readonly drawing: Drawing;
  readonly rx: number;
};

const CurrentRing = ({ node, drawing, rx }: CurrentRingProps) =>
  node.id === drawing.current && (
    <rect className="current-ring" {...ringAround({ node, scale: drawing.scale })} rx={rx} />
  );

type ToggleProps = {
  readonly node: PlacedNode;
  readonly expanded: boolean;
  readonly onToggle: (id: string) => void;
};

const Toggle = ({ node, expanded, onToggle }: ToggleProps) => (
  <g
    {...pressable(() => onToggle(node.id))}
    role="button"
    tabIndex={0}
    aria-label={`${expanded ? 'Collapse' : 'Expand'} ${node.label}`}
    aria-expanded={expanded}
    className="toggle"
    transform={`translate(${node.x} ${node.y})`}
  >
    <circle r={8} />
    <path d={expanded ? 'M -4 0 H 4' : 'M -4 0 H 4 M 0 -4 V 4'} />
  </g>
);

const NodeView = ({ node, drawing }: { readonly node: PlacedNode; readonly drawing: Drawing }) => {
  const { notes, onSelect, register, expandable, expanded, onToggle, unroutedOf, shadeOf, inMap } =
    drawing;
  const unrouted = unroutedOf(node.id);
  const shade = shadeOf(node);
  const found = drawing.findingsOn(node.id);
  const number = drawing.numberOf(node.id);
  const numberX = expandable.has(node.id) ? 24 : 0;
  const toggle = expandable.has(node.id) && (
    <Toggle node={node} expanded={expanded.has(node.id)} onToggle={onToggle} />
  );
  if (node.children.length > 0) {
    return (
      <>
        <g
          role="group"
          aria-label={node.label}
          aria-current={node.id === drawing.current || undefined}
          className="module"
          data-state={node.state}
          transform={`translate(${node.x} ${node.y})`}
        >
          <rect className="module-box" width={node.width} height={node.height} rx={8} />
          <CurrentRing node={node} drawing={drawing} rx={8} />
          <text className="module-label" x={16} y={26}>
            {node.label}
            {node.formerLabel !== undefined && (
              <tspan className="former" x={16} dy="1.3em">
                was {node.formerLabel}
              </tspan>
            )}
          </text>
          {node.children.map(child => (
            <NodeView key={child.id} node={child} drawing={drawing} />
          ))}
          {number !== undefined && <ReadingNumber number={number} x={numberX} />}
        </g>
        {toggle}
      </>
    );
  }
  return (
    <>
      <g
        {...selectable({
          id: node.id,
          name: [
            `${node.label}: ${node.state}`,
            ...(node.formerLabel === undefined ? [] : [`was ${node.formerLabel}`]),
            ...(node.renamedFrom === undefined ? [] : [`renamed from ${node.renamedFrom}`]),
            ...(unrouted.length > 0 ? [`no route for ${unrouted.join(', ')}`] : []),
            ...(shade === undefined ? [] : [shade.name]),
          ].join(', '),
          note: notes[node.id],
          onSelect,
          register,
          inMap,
        })}
        aria-current={node.id === drawing.current || undefined}
        className="node"
        data-state={node.state}
        data-step={shade?.step}
        transform={`translate(${node.x} ${node.y})`}
      >
        <title>
          {`${node.path} — ${[node.state, ...(shade === undefined ? [] : [shade.name])].join(', ')}`}
        </title>
        <rect width={node.width} height={node.height} rx={6} />
        <CurrentRing node={node} drawing={drawing} rx={6} />
        <text x={node.width / 2} y={node.height / 2}>
          {node.formerLabel === undefined ? (
            node.label
          ) : (
            <>
              <tspan x={node.width / 2} dy="-0.6em">
                {node.label}
              </tspan>
              <tspan className="former" x={node.width / 2} dy="1.3em">
                was {node.formerLabel}
              </tspan>
            </>
          )}
        </text>
        {found.length > 0 && (
          <FindingsBadge x={node.width} y={0} findings={found} picked={drawing.picked} />
        )}
        {number !== undefined && <ReadingNumber number={number} x={numberX} />}
      </g>
      {toggle}
    </>
  );
};

const descendantsOf = (node: PlacedNode): ReadonlyArray<PlacedNode> =>
  node.children.flatMap(child => [child, ...descendantsOf(child)]);

type EdgeViewProps = {
  readonly edge: PlacedEdge;
  readonly name: string;
  readonly drawing: Drawing;
};

const EdgeView = ({ edge, name, drawing }: EdgeViewProps) => {
  const { notes, onSelect, register, findingsOn, inMap } = drawing;
  const id = edgeId(edge);
  const note = notes[id];
  const found = findingsOn(id);
  return (
    <>
      <path
        {...(inMap ? {} : selectable({ id, name, note, onSelect, register, inMap }))}
        className={edge.via ? 'edge call' : 'edge'}
        data-state={edge.state}
        d={edgePath(edge.points)}
        markerEnd={`url(#arrow-${edge.state})`}
      />
      {found.length > 0 && (
        <FindingsBadge
          {...middleOf(edge.points)}
          findings={found}
          picked={drawing.picked}
          {...(inMap ? {} : { onPress: () => onSelect(id) })}
        />
      )}
    </>
  );
};

const Stack = ({ stack, drawing }: { readonly stack: PlacedStack; readonly drawing: Drawing }) => {
  const labelOf = new Map(descendantsOf(stack).map(node => [node.id, node.label]));
  return (
    <g role="group" aria-label={stack.label} transform={`translate(${stack.x} ${stack.y})`}>
      <rect className="stack" width={stack.width} height={stack.height} rx={10} />
      <text className="stack-label" x={16} y={26}>
        {stack.label}
      </text>
      {stack.edges.map(edge => (
        <EdgeView
          key={edgeId(edge)}
          edge={edge}
          name={`${labelOf.get(edge.from)} → ${labelOf.get(edge.to)}: ${edge.state}`}
          drawing={drawing}
        />
      ))}
      {stack.children.map(node => (
        <NodeView key={node.id} node={node} drawing={drawing} />
      ))}
    </g>
  );
};

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

const ZOOM_STEP = 1.25;

type ZoomProps = {
  readonly scale: number;
  readonly onZoom: (scale: number) => void;
  readonly onFit: () => void;
};

const Zoom = ({ scale, onZoom, onFit }: ZoomProps) => (
  <div className="zoom" role="toolbar" aria-label="View">
    <button type="button" aria-label="Zoom out" onClick={() => onZoom(scale / ZOOM_STEP)}>
      −
    </button>
    <output aria-label="Zoom">{Math.round(scale * 100)}%</output>
    <button type="button" aria-label="Zoom in" onClick={() => onZoom(scale * ZOOM_STEP)}>
      +
    </button>
    <button type="button" onClick={onFit}>
      Fit
    </button>
    <button type="button" onClick={() => onZoom(1)}>
      100%
    </button>
  </div>
);

const endsOf = (range: string) => {
  const at = range.indexOf('..');
  return { from: range.slice(0, at), to: range.slice(at + 2) };
};

const shortRange = (range: string) => {
  const { from, to } = endsOf(range);
  return `${shortRef(from)}..${shortRef(to)}`;
};

const ShortRange = ({ range }: { readonly range: string }) => {
  const { from, to } = endsOf(range);
  return (
    <>
      <Ref name={from} />
      ..
      <Ref name={to} />
    </>
  );
};

const Legend = () => (
  <ul className="legend" aria-label="Legend">
    {STATES.map(state => (
      <li key={state} data-state={state}>
        <span className="swatch" aria-hidden="true" />
        {state}
      </li>
    ))}
  </ul>
);

const Scoped = ({ scopes: [scope, ...inner], text }: Piece) =>
  scope === undefined ? (
    text
  ) : (
    <span className={scope}>
      <Scoped scopes={inner} text={text} />
    </span>
  );

type Landing = Omit<LineAt, 'node'> & { readonly text?: string };

type LandingIn = Partial<Landing> & { readonly path: string | undefined } & RowLanding;

const onThePart = (landing: LandingIn | undefined) =>
  landing?.path === undefined && landing?.row === undefined ? landing : undefined;

const rowLandedOn = (
  lines: ReadonlyArray<Line>,
  path: string,
  { side, line, text }: Partial<Landing>,
) => {
  if (side === undefined || line === undefined) return undefined;
  return text === undefined
    ? lines.findIndex(row => row[side] === line)
    : rowOfLine(lines, { path, side, line, text });
};

type LineComments = {
  readonly nodes: ReadonlyArray<DiffNode>;
  readonly comments: Comments;
  readonly onComment: ((comment: Comment) => void) | undefined;
};

const PatchLine = ({
  path,
  line,
  said,
  landing,
  nodes,
  comments,
  onComment,
}: LineComments & {
  readonly path: string;
  readonly line: Line;
  readonly said: ReadonlyArray<PreviousComment['anchor']>;
  readonly landing: Partial<Landing> | undefined;
}) => {
  const { kind, prefix, pieces } = line;
  const anchor = lineAnchor({ path, line });
  const marks = { 'aria-current': landing !== undefined || undefined };
  const code = (
    <>
      {prefix}
      {pieces.map((piece, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a line's pieces are fixed and may repeat
        <Scoped key={index} {...piece} />
      ))}
      {said.map(on => (
        <SaidBefore key={on.id} on={on} landing={landing} />
      ))}
      {onComment && anchor && (
        <CommentOn
          anchor={anchor}
          name={anchorName(anchor, nodes)}
          comments={comments}
          onComment={onComment}
          landing={landing}
        />
      )}
    </>
  );
  if (kind === 'added') return <ins {...marks}>{code}</ins>;
  if (kind === 'removed') return <del {...marks}>{code}</del>;
  return <span {...marks}>{code}</span>;
};

const holdsLineDraft = (comments: Comments, path: string) =>
  Object.values(comments).some(({ anchor }) => placeOfLine(anchor)?.path === path);

const Patch = ({
  path,
  patch,
  open,
  landing,
  ...commenting
}: FilePatch &
  LineComments & { readonly open: boolean; readonly landing: LandingIn | undefined }) => {
  const lines = useMemo(() => highlightPatch({ path, patch }), [path, patch]);
  const marked = useIsChangedSince()('files', path);
  const saidLines = useSaidLinesOf(path);
  const placed = saidLines.map(({ anchor, place }) => ({ anchor, row: rowOfLine(lines, place) }));
  const saidAt = (row: number | undefined) =>
    placed.filter(said => said.row === row).map(({ anchor }) => anchor);
  const landed = landing?.path === path ? landing : undefined;
  const landedRow = landed && rowLandedOn(lines, path, landed);
  const top = useRef<HTMLDetailsElement>(null);
  useLayoutEffect(() => {
    if (!top.current || landed === undefined) return;
    top.current.open = true;
    const row = top.current.querySelector<HTMLElement>('[aria-current]');
    if (row) scrollInPanel(row, 'center');
    else scrollInPanel(top.current, 'start');
  }, [landed]);
  const holdsDraft = holdsLineDraft(commenting.comments, path);
  return (
    <details aria-label={path} open={open || holdsDraft || saidLines.length > 0} ref={top}>
      <summary>
        {path}
        <ChangedSinceTag marked={marked} />
      </summary>
      {saidAt(undefined).map(on => (
        <SaidBefore key={on.id} on={on} landing={landed} />
      ))}
      <pre>
        {lines.map((line, index) => (
          <PatchLine
            // biome-ignore lint/suspicious/noArrayIndexKey: a patch's lines are fixed and may repeat
            key={index}
            path={path}
            line={line}
            said={saidAt(index)}
            landing={index === landedRow ? landed : undefined}
            {...commenting}
          />
        ))}
      </pre>
    </details>
  );
};

type DiffNode = GraphDiff['nodes'][number];

const stackOf = (nodes: ReadonlyArray<DiffNode>, node: DiffNode): DiffNode => {
  const parent = nodes.find(other => other.id === node.parent);
  return parent ? stackOf(nodes, parent) : node;
};

type Walking = {
  readonly read: boolean | undefined;
  readonly onToggleRead: () => void;
  readonly next: DiffNode | undefined;
  readonly onGoTo: (id: string) => void;
};

const KeyHint = ({ letter }: { readonly letter: string }) => (
  <span aria-hidden="true">
    <kbd>{letter}</kbd>
  </span>
);

const InspectorHead = ({
  nodes,
  node,
  walking: { read, onToggleRead, next, onGoTo },
  anchor,
  comments,
  onComment,
  landing,
  heading,
}: {
  readonly heading: RefObject<HTMLHeadingElement | null>;
  readonly nodes: ReadonlyArray<DiffNode>;
  readonly node: DiffNode;
  readonly walking: Walking;
  readonly anchor: Comment['anchor'];
  readonly landing: LandingIn | undefined;
  readonly comments: Comments;
  readonly onComment: ((comment: Comment) => void) | undefined;
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
      {onComment && (
        <CommentOn
          key={node.id}
          anchor={anchor}
          name={node.label}
          word={
            <>
              Comment <KeyHint letter="C" />
            </>
          }
          comments={comments}
          onComment={onComment}
          landing={onThePart(landing)}
        />
      )}
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
    </div>
  </header>
);

type InspectorProps = {
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
  readonly onGoTo: (id: string) => void;
  readonly anchor: Comment['anchor'];
  readonly comments: Comments;
  readonly onComment: ((comment: Comment) => void) | undefined;
  readonly commentable: boolean;
  readonly saidInPlace: ReadonlyArray<string>;
  readonly answers: Answers;
  readonly onAnswer: AnswerTo | undefined;
  readonly width: number | undefined;
  readonly onClose: () => void;
  readonly walking: Walking;
  readonly heading: RefObject<HTMLHeadingElement | null>;
};

type LandingPlace = string | null | undefined;

const useLanding = (place: LandingPlace) => {
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

type FullDiffProps = LineComments & {
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
  const onAPatch = landing?.path === undefined ? undefined : landing;
  const wanted =
    onAPatch !== undefined || patches.some(({ path }) => holdsLineDraft(commenting.comments, path));
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
  | 'tests'
  | 'onGoTo'
  | 'note'
  | 'found'
  | 'anchor'
  | 'comments'
  | 'onComment'
  | 'commentable'
  | 'saidInPlace'
  | 'answers'
  | 'onAnswer'
  | 'landing'
> & {
  readonly onShowLine: (at: LineAt) => void;
};

const WhyLook = (rows: FindingRowsProps) => (
  <section className="column-section" aria-label="Why look">
    <h3>Why look</h3>
    <FindingRows {...rows} />
  </section>
);

const isUntestedLogic = ({ check }: Finding) => check === 'tests:untested-logic';

const NotePanel = ({
  nodes,
  node,
  symbols,
  tests,
  onGoTo,
  onShowLine,
  landing,
  note,
  found,
  anchor,
  comments,
  onComment,
  commentable,
  saidInPlace,
  answers,
  onAnswer,
}: NotePanelProps) => {
  const filesWithNews = useFilesWithNews(node, symbols, nodes);
  const hasSaid = useHasSaid();
  const testsToRead = useTestsToRead(node ? testsAlongside({ nodes, node, tests }) : [], comments);
  const untested = found.filter(isUntestedLogic);
  const toLookAt = found.filter(finding => !isUntestedLogic(finding));
  const isBare =
    filesWithNews.length === 0 &&
    found.length === 0 &&
    testsToRead.length === 0 &&
    !hasSaid(anchor) &&
    saidInPlace.length === 0;
  const shownNote = note?.text ?? (isBare ? 'No note' : undefined);
  return (
    <LandedRows landing={landing}>
      {shownNote !== undefined && (
        <section aria-label="Note">
          <p>{shownNote}</p>
        </section>
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
          <CommentFieldUnlessSaid anchor={anchor} comments={comments} onComment={onComment} />
        ) : (
          <p>Drawn for several edges: open its ends to comment on one of them.</p>
        ))}
      {node && filesWithNews.length > 0 && (
        <WhatChanged
          node={node}
          files={filesWithNews}
          nodes={nodes}
          onGoTo={onGoTo}
          onShowLine={onShowLine}
          comments={comments}
          onComment={onComment}
        />
      )}
      {toLookAt.length > 0 && <WhyLook found={toLookAt} answers={answers} onAnswer={onAnswer} />}
      {(testsToRead.length > 0 || untested.length > 0) && (
        <TestedBy
          drawn={testsToRead}
          nodes={nodes}
          comments={comments}
          onComment={onComment}
          found={untested}
          answers={answers}
          onAnswer={onAnswer}
        />
      )}
    </LandedRows>
  );
};

const Inspector = ({
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
          comments={props.comments}
          onComment={props.onComment}
          landing={landing}
        />
      )}
      <NotePanel {...props} node={node} onShowLine={showLine} landing={landing} />
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
          comments={props.comments}
          onComment={props.onComment}
        />
      )}
    </aside>
  );
};

type OutsideFilesProps = LineComments & {
  readonly patches: ReadonlyArray<FilePatch>;
  readonly landing: LandingIn | undefined;
  readonly width: number | undefined;
  readonly onClose: () => void;
};

const OutsideFiles = ({ patches, landing, width, onClose, ...commenting }: OutsideFilesProps) => (
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

type SidePanelProps = {
  readonly review: PageData;
  readonly selected: string | undefined;
  readonly node: DiffNode | undefined;
  readonly outside: boolean;
  readonly note: Note | undefined;
  readonly saidInPlace: ReadonlyArray<string>;
  readonly found: ReadonlyArray<Finding>;
  readonly comments: Comments;
  readonly onComment: ((comment: Comment) => void) | undefined;
  readonly answers: Answers;
  readonly onAnswer: AnswerTo | undefined;
  readonly chosenWidth: number | undefined;
  readonly onChooseWidth: (width: number) => void;
  readonly graphLeft: () => number;
  readonly onCloseOutside: () => void;
  readonly onCloseInspector: (id: string) => void;
  readonly onGoTo: (id: string) => void;
  readonly onWalkTo: (id: string) => void;
  readonly landing: LandingIn | undefined;
  readonly onLand: (landing: LandingIn) => void;
  readonly read: ReadonlySet<string>;
  readonly onToggleRead: (id: string) => void;
  readonly commentAsked: { readonly on: string } | undefined;
  readonly heading: RefObject<HTMLHeadingElement | null>;
  readonly reading: boolean;
};

const partFrom = (parts: ReadonlyArray<string>, selected: string | undefined, step: number) =>
  parts[Math.max(parts.indexOf(selected ?? '') + step, 0)];

const SidePanel = ({
  review,
  selected,
  node,
  outside,
  note,
  saidInPlace,
  found,
  comments,
  onComment,
  answers,
  onAnswer,
  chosenWidth,
  onChooseWidth,
  graphLeft,
  onCloseOutside,
  onCloseInspector,
  onGoTo,
  onWalkTo,
  landing,
  onLand,
  read,
  onToggleRead,
  commentAsked,
  heading,
  reading,
}: SidePanelProps) => {
  const patches = outside
    ? review.undrawn
    : node
      ? review.patches.filter(({ path }) => isAtOrUnder(path, node))
      : [];
  const width = chosenWidth ?? (patches.length > 0 ? CHANGES_WIDTH : NOTE_WIDTH);
  const shownWidth = reading ? undefined : width;
  const moveDivider = (event: KeyboardEvent) => {
    const step = { ArrowLeft: DIVIDER_STEP, ArrowRight: -DIVIDER_STEP }[event.key];
    if (step === undefined) return;
    onChooseWidth(panelWidthWithin(width + step, graphLeft()));
  };
  const dragDivider = (down: PointerEvent<HTMLDivElement>) => {
    down.preventDefault();
    down.currentTarget.focus();
    const follow = (move: globalThis.PointerEvent) =>
      onChooseWidth(panelWidthWithin(width + down.clientX - move.clientX, graphLeft()));
    window.addEventListener('pointermove', follow);
    window.addEventListener('pointerup', () => window.removeEventListener('pointermove', follow), {
      once: true,
    });
  };
  const divider = !reading && (
    <div
      className="divider"
      role="separator"
      aria-orientation="vertical"
      aria-label="Panel width"
      aria-valuenow={width}
      tabIndex={0}
      onKeyDown={moveDivider}
      onPointerDown={dragDivider}
    />
  );
  if (outside) {
    return (
      <>
        {divider}
        <OutsideFiles
          patches={patches}
          landing={landing}
          width={shownWidth}
          onClose={onCloseOutside}
          nodes={review.diff.nodes}
          comments={comments}
          onComment={onComment}
        />
      </>
    );
  }
  if (selected === undefined) return null;
  const anchor = { kind: node === undefined ? 'edge' : 'part', id: selected } as const;
  const { parts } = review.readingOrder;
  const nextId = partFrom(parts, selected, 1);
  return (
    <CommentAsked.Provider
      value={commentAsked && { anchor: anchorKey(anchor), request: commentAsked }}
    >
      {divider}
      <Inspector
        heading={heading}
        nodes={review.diff.nodes}
        node={node}
        metrics={review.metrics}
        findings={metricFindings(review)}
        note={note}
        found={found}
        patches={patches}
        tests={review.tests}
        symbols={review.symbols}
        onGoTo={onGoTo}
        anchor={anchor}
        comments={comments}
        onComment={onComment}
        commentable={
          node !== undefined || review.diff.edges.some(edge => edgeId(edge) === selected)
        }
        saidInPlace={saidInPlace}
        answers={answers}
        onAnswer={onAnswer}
        width={shownWidth}
        onClose={() => onCloseInspector(selected)}
        landing={landing}
        onLand={onLand}
        walking={{
          read: parts.includes(selected) ? read.has(selected) : undefined,
          onToggleRead: () => onToggleRead(selected),
          next: review.diff.nodes.find(({ id }) => id === nextId),
          onGoTo: onWalkTo,
        }}
      />
    </CommentAsked.Provider>
  );
};

type DrawnAtOptions = {
  readonly diff: GraphDiff;
  readonly expanded: ReadonlySet<string>;
  readonly noted: ReadonlySet<string>;
  readonly allEdges: boolean;
};

const drawnAt = ({ diff, expanded, noted, allEdges }: DrawnAtOptions): GraphDiff =>
  allEdges ? visibleDiff({ diff, expanded }) : mergedDiff({ diff, expanded, noted });

type SaidInPlaceOptions = DrawnAtOptions & {
  readonly comments: ReadonlyArray<PreviousComment>;
  readonly arrow: string | undefined;
};

const edgesSaidInPlace = ({ comments, arrow, diff, ...at }: SaidInPlaceOptions) =>
  comments
    .flatMap(({ target }) => target ?? [])
    .filter(
      target =>
        target !== arrow &&
        drawnAt({
          ...at,
          diff: { ...diff, edges: diff.edges.filter(edge => edgeId(edge) === target) },
        }).edges.some(edge => edgeId(edge) === arrow),
    );

type Keeping = {
  readonly diff: GraphDiff;
  readonly expanded: ReadonlySet<string>;
  readonly drawn: GraphDiff;
};

type Scope = readonly [name: string, keep: (keeping: Keeping) => GraphDiff];

const SINCE_LAST_REVIEW = 'Since last review';

const CHANGES_ONLY: Scope = ['Changes only', changesOnly];

const EVERYTHING: Scope = ['Everything', ({ drawn }) => drawn];

const WIDER_SCOPES: ReadonlyArray<Scope> = [
  CHANGES_ONLY,
  ['Changed + 1 hop', ({ drawn }) => nearChanges(drawn)],
  EVERYTHING,
];

const stillReadIn = ({ sinceReview }: PageData): ReadonlyArray<string> =>
  sinceReview !== undefined && 'stillRead' in sinceReview ? sinceReview.stillRead : [];

const changedSinceIn = ({ sinceReview }: PageData): ChangedSince | undefined =>
  sinceReview !== undefined && 'changed' in sinceReview ? sinceReview.changed : undefined;

const changedSinceShown = ([name]: Scope, review: PageData) =>
  name === SINCE_LAST_REVIEW ? changedSinceIn(review) : undefined;

const unmergedWith = (noted: ReadonlySet<string>, since: ChangedSince | undefined) =>
  new Set([...noted, ...(since?.edges ?? [])]);

const scopesOf = (review: PageData): ReadonlyArray<Scope> => {
  const changed = changedSinceIn(review);
  return changed === undefined
    ? WIDER_SCOPES
    : [[SINCE_LAST_REVIEW, keeping => sinceLastReview({ ...keeping, changed })], ...WIDER_SCOPES];
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

type Chosen =
  | {
      readonly view: View;
      readonly of: Layout;
      readonly in: Size;
      readonly pin?: string | undefined;
    }
  | { readonly centre: string };

type ViewOnOptions = {
  readonly layout: Layout;
  readonly frame: Size;
  readonly chosen: Chosen | undefined;
};

const viewOn = ({ layout, frame, chosen }: ViewOnOptions): View => {
  const fit = fitted({ graph: layout, frame });
  if (chosen === undefined) return fit;
  if ('centre' in chosen) {
    const box = boxOf({ layout, id: chosen.centre });
    return box ? centred({ graph: layout, frame, box }) : fit;
  }
  if (chosen.of === layout)
    return resized({ graph: layout, frame, view: chosen.view, from: chosen.in });
  if (chosen.pin === undefined) return fit;
  const from = boxOf({ layout: chosen.of, id: chosen.pin });
  const to = boxOf({ layout, id: chosen.pin });
  return from && to ? pinned({ graph: layout, frame, view: chosen.view, from, to }) : fit;
};

const TABS = {
  structure: 'Structure',
  metrics: 'Metrics',
  tests: 'Tests',
  schema: 'Schema',
  routes: 'Routes',
} as const;

type Tab = keyof typeof TABS;

const useGraphView = (layout: Layout | undefined, map: boolean) => {
  const [frameElement, setFrameElement] = useState<HTMLDivElement | null>(null);
  const [frameWidth, setFrameWidth] = useState<number>();
  useEffect(() => {
    if (!frameElement) return;
    const observer = new ResizeObserver(([entry]) => setFrameWidth(entry?.contentRect.width));
    observer.observe(frameElement);
    return () => observer.disconnect();
  }, [frameElement]);
  const frame =
    layout && frameWidth !== undefined
      ? {
          width: frameWidth,
          height: map
            ? mapHeight({ graph: layout, frameWidth })
            : frameHeight({ graph: layout, frameWidth, windowHeight: window.innerHeight }),
        }
      : undefined;
  const [chosen, setChosen] = useState<Chosen>();
  const view =
    layout && frame && (map ? fitted({ graph: layout, frame }) : viewOn({ layout, frame, chosen }));
  const placed = layout && frame && view && { graph: layout, frame, view };
  const choose = (next: (on: NonNullable<typeof placed>) => View, pin?: string) => {
    if (placed) setChosen({ of: placed.graph, view: next(placed), in: placed.frame, pin });
  };
  const dragged = useRef(false);
  const pan = (down: PointerEvent<HTMLDivElement>) => {
    dragged.current = false;
    if (map || down.button !== 0) return;
    const follow = (move: globalThis.PointerEvent) => {
      const by = { x: move.clientX - down.clientX, y: move.clientY - down.clientY };
      dragged.current ||= Math.hypot(by.x, by.y) >= LEAST_DRAG;
      if (dragged.current) choose(on => panned({ ...on, by }));
    };
    const released = new AbortController();
    const release = () => released.abort();
    window.addEventListener('pointermove', follow, { signal: released.signal });
    window.addEventListener('pointerup', release, { signal: released.signal });
    window.addEventListener('pointercancel', release, { signal: released.signal });
  };
  const zoomAtCentre = (scale: number) =>
    choose(on => zoomed({ ...on, scale, at: { x: on.frame.width / 2, y: on.frame.height / 2 } }));
  const fitToFrame = () => setChosen(undefined);
  const keyed = (event: KeyboardEvent) => {
    if (map || !view || event.ctrlKey || event.metaKey || event.altKey) return;
    const panBy = (x: number, y: number) => () => choose(on => panned({ ...on, by: { x, y } }));
    const act = {
      '+': () => zoomAtCentre(view.scale * ZOOM_STEP),
      '=': () => zoomAtCentre(view.scale * ZOOM_STEP),
      '-': () => zoomAtCentre(view.scale / ZOOM_STEP),
      '1': () => zoomAtCentre(1),
      '0': fitToFrame,
      ArrowLeft: panBy(PAN_STEP, 0),
      ArrowRight: panBy(-PAN_STEP, 0),
      ArrowUp: panBy(0, PAN_STEP),
      ArrowDown: panBy(0, -PAN_STEP),
    }[event.key];
    if (!act) return;
    event.preventDefault();
    act();
  };
  const wheel = useEffectEvent((event: WheelEvent) => {
    if (map || !frameElement || !placed) return;
    const bounds = frameElement.getBoundingClientRect();
    const at = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    const by = { x: -event.deltaX, y: -event.deltaY };
    const zooming = event.ctrlKey || event.metaKey;
    const next = zooming
      ? zoomed({
          ...placed,
          scale: placed.view.scale * 2 ** (-event.deltaY / WHEEL_PER_DOUBLING),
          at,
        })
      : panned({ ...placed, by });
    if (!zooming && next.x === placed.view.x && next.y === placed.view.y) return;
    event.preventDefault();
    choose(() => next);
  });
  useEffect(() => {
    if (!frameElement) return;
    const onWheel = (event: WheelEvent) => wheel(event);
    frameElement.addEventListener('wheel', onWheel, { passive: false });
    return () => frameElement.removeEventListener('wheel', onWheel);
  }, [frameElement]);
  return {
    frameElement,
    placed,
    frameProps: {
      ref: setFrameElement,
      style: { height: frame?.height },
      onKeyDown: keyed,
      onPointerDown: pan,
      onClickCapture: (event: MouseEvent) => {
        if (dragged.current && event.detail > 0) event.stopPropagation();
      },
    },
    zoomAtCentre,
    fitToFrame,
    centre: (id: string) => setChosen({ centre: id }),
    pin: (id: string) => choose(on => on.view, id),
  };
};

const tabsOf = ({ schemas, routes }: Pick<PageData, 'schemas' | 'routes'>): ReadonlyArray<Tab> => [
  'structure',
  'metrics',
  'tests',
  ...(schemas.length === 0 ? [] : (['schema'] as const)),
  ...(routes.length === 0 ? [] : (['routes'] as const)),
];

const tabAt = (review: PageData, hash: string): Tab =>
  tabsOf(review).find(tab => `#${tab}` === hash) ?? 'structure';

const useTab = (review: PageData): Tab => {
  const [tab, setTab] = useState(() => tabAt(review, location.hash));
  useEffect(() => {
    const follow = () => setTab(tabAt(review, location.hash));
    addEventListener('hashchange', follow);
    return () => removeEventListener('hashchange', follow);
  }, [review]);
  return tab;
};

type HeaderProps = {
  readonly review: PageData;
  readonly tab: Tab;
  readonly read: ReadonlySet<string>;
};

const LastVerdict = ({ since }: { readonly since: SinceReview }) => (
  <p className="where">
    Last review at <Ref name={since.head} />: {verdictLabels.get(since.verdict)}
  </p>
);

const UncomparedReview = ({ since }: { readonly since: SinceReview }) => {
  if ('gone' in since)
    return (
      <p className="where">
        The commit last reviewed, <Ref name={since.head} />, is gone: the full review is shown.
      </p>
    );
  if ('unreadable' in since)
    return (
      <p className="where" title={since.unreadable}>
        The commit last reviewed, <Ref name={since.head} />, couldn't be read: the full review is
        shown.
      </p>
    );
  return null;
};

type ReadingProgressProps = {
  readonly parts: ReadonlyArray<string>;
  readonly read: ReadonlySet<string>;
};

const ReadingProgress = ({ parts, read }: ReadingProgressProps) => {
  if (parts.length === 0) return null;
  const count = parts.filter(part => read.has(part)).length;
  return (
    <p className="reading-progress">
      {partsRead({ read: count, parts: parts.length })}{' '}
      <progress aria-label="Parts read" value={count} max={parts.length} />
    </p>
  );
};

const Header = ({ review, tab, read }: HeaderProps) => {
  const changed = changedCount(review.tests);
  return (
    <header className="review">
      <div className="title">
        <p className="where">
          {review.repo} ·{' '}
          <code>
            <ShortRange range={review.range} />
          </code>
        </p>
        <h1>
          {review.pullRequest ? (
            <a href={review.pullRequest.url}>
              #{review.pullRequest.number} {review.pullRequest.title}
            </a>
          ) : review.range === UNCOMMITTED ? (
            'Uncommitted work'
          ) : (
            <ShortRange range={review.range} />
          )}
        </h1>
        {review.sinceReview !== undefined && (
          <>
            <LastVerdict since={review.sinceReview} />
            <UncomparedReview since={review.sinceReview} />
          </>
        )}
        <ReadingProgress parts={review.readingOrder.parts} read={read} />
      </div>
      <nav aria-label="Review">
        {tabsOf(review).map(shown => (
          <a key={shown} href={`#${shown}`} aria-current={shown === tab ? 'page' : undefined}>
            {TABS[shown]}
            {shown === 'tests' && changed > 0 && (
              <>
                {' '}
                <span className="badge">{changed}</span>
              </>
            )}
          </a>
        ))}
      </nav>
    </header>
  );
};

const toggled = (set: ReadonlySet<string>, id: string) =>
  set.has(id) ? new Set([...set].filter(other => other !== id)) : new Set([...set, id]);

type ReviewPageProps = {
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

type GraphFrameProps = Pick<ReturnType<typeof useGraphView>, 'placed' | 'frameProps'> & {
  readonly layout: Layout;
  readonly reading: boolean;
  readonly drawing: Drawing;
  readonly colouring: Colouring;
  readonly range: string;
  readonly labelOf: ReadonlyMap<string, string>;
  readonly onOpenMap: () => void;
  readonly onZoom: (scale: number) => void;
  readonly onFit: () => void;
};

const GraphFrame = ({
  layout,
  placed,
  frameProps,
  reading,
  drawing,
  colouring,
  range,
  labelOf,
  onOpenMap,
  onZoom,
  onFit,
}: GraphFrameProps) => (
  <div
    className="frame"
    role="group"
    aria-label={reading ? 'Map' : 'Graph'}
    tabIndex={reading ? -1 : 0}
    {...frameProps}
  >
    {placed && (
      <>
        {reading ? (
          <button type="button" className="open-map" onClick={onOpenMap}>
            Open map
          </button>
        ) : (
          <Zoom scale={placed.view.scale} onZoom={onZoom} onFit={onFit} />
        )}
        <svg className="graph" data-colouring={colouring}>
          <title>{`Structure ${shortRange(range)}`}</title>
          <defs>
            {STATES.map(state => (
              <marker
                key={state}
                id={`arrow-${state}`}
                className="arrow"
                data-state={state}
                viewBox="0 0 10 10"
                refX={9}
                refY={5}
                markerWidth={7}
                markerHeight={7}
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" />
              </marker>
            ))}
          </defs>
          <g transform={`translate(${placed.view.x} ${placed.view.y}) scale(${placed.view.scale})`}>
            {layout.stacks.map(stack => (
              <Stack key={stack.id} stack={stack} drawing={drawing} />
            ))}
            {layout.calls.map(edge => (
              <EdgeView
                key={edgeId(edge)}
                edge={edge}
                name={`${labelOf.get(edge.from)} ⇢ ${labelOf.get(edge.to)}: ${edge.state} (${edge.via?.join(', ')})`}
                drawing={drawing}
              />
            ))}
          </g>
        </svg>
      </>
    )}
  </div>
);

type GraphControlsProps = {
  readonly colouring: Colouring;
  readonly onColouring: (colouring: Colouring) => void;
  readonly scopes: ReadonlyArray<Scope>;
  readonly scope: Scope;
  readonly onScope: (scope: Scope) => void;
  readonly allEdges: boolean;
  readonly onAllEdges: (allEdges: boolean) => void;
};

const GraphControls = ({
  colouring,
  onColouring,
  scopes,
  scope,
  onScope,
  allEdges,
  onAllEdges,
}: GraphControlsProps) => (
  <>
    <div className="graph-controls">
      <ColourBy colouring={colouring} onPick={onColouring} />
      <div className="graph-filters">
        <Show scopes={scopes} scope={scope} onPick={onScope} />
        <label className="near-only">
          <input
            type="checkbox"
            checked={allEdges}
            onChange={event => onAllEdges(event.target.checked)}
          />
          All edges
        </label>
      </div>
    </div>
    <div className="graph-key">
      {colouring === 'change' ? <Legend /> : <ScaleLegend colouring={colouring} />}
    </div>
  </>
);

type LandingHeadProps = GraphControlsProps &
  GraphCaveatProps & {
    readonly review: PageData;
    readonly notes: ReviewPageProps['notes'];
    readonly findings: ReadonlyArray<Finding>;
    readonly inLens: ReadonlyArray<Finding>;
    readonly picked: Lens | undefined;
    readonly onPick: (lens: Lens | undefined) => void;
    readonly onShowAll: () => void;
    readonly startHereOpen: boolean;
    readonly onStartHereOpen: (open: boolean) => void;
    readonly onGoTo: (id: string) => void;
    readonly onGoToFinding: (id: string, finding: string) => void;
    readonly onShowOutside: (opener: HTMLButtonElement) => void;
    readonly onShowFile: (path: string, opener: HTMLButtonElement, place?: string) => void;
  };

const LandingHead = ({
  review,
  notes,
  findings,
  inLens,
  picked,
  onPick,
  onShowAll,
  startHereOpen,
  onStartHereOpen,
  onGoTo,
  onGoToFinding,
  onShowOutside,
  onShowFile,
  since,
  nothingDrawn,
  ...controls
}: LandingHeadProps) => (
  <>
    {notes && notes.summary.length > 0 && <Summary notes={notes} onGoTo={onGoTo} />}
    <LensChips findings={findings} coverage={review.coverage} picked={picked} onPick={onPick} />
    <LensRow picked={picked} findings={findings} coverage={review.coverage} />
    <StartHere
      findings={inLens}
      onShowAll={onShowAll}
      open={startHereOpen}
      onOpen={onStartHereOpen}
      review={review}
      onGoTo={onGoTo}
      onGoToFinding={onGoToFinding}
      onShowOutside={onShowOutside}
      onShowFile={onShowFile}
    />
    <GraphControls {...controls} />
    <GraphCaveat since={since} nothingDrawn={nothingDrawn} />
  </>
);

type LeftColumnProps = {
  readonly review: PageData;
  readonly notes: ReviewPageProps['notes'];
  readonly reading: boolean;
  readonly read: ReadonlySet<string>;
  readonly selected: string | undefined;
  readonly commentable: boolean;
  readonly findings: ReadonlyArray<Finding>;
  readonly inLens: ReadonlyArray<Finding>;
  readonly railOpen: boolean;
  readonly onRailOpen: (open: boolean) => void;
  readonly answers: Answers;
  readonly onAnswer: AnswerTo | undefined;
  readonly onGoTo: (id: string) => void;
  readonly onWalkTo: (id: string) => void;
  readonly onStart: () => void;
  readonly onGoToDraft: (id: string, anchor: PreviousComment['anchor']) => void;
  readonly onGoToFinding: (id: string, finding: string) => void;
  readonly onGoToOutside: (place: LandingIn, opener: HTMLButtonElement) => void;
  readonly onShowOutside: (opener: HTMLButtonElement) => void;
  readonly onShowFile: (path: string, opener: HTMLButtonElement, place?: string) => void;
};

const LeftColumn = ({
  review,
  notes,
  reading,
  read,
  selected,
  commentable,
  findings,
  inLens,
  railOpen,
  onRailOpen,
  answers,
  onAnswer,
  onGoTo,
  onWalkTo,
  onStart,
  onGoToDraft,
  onGoToFinding,
  onGoToOutside,
  onShowOutside,
  onShowFile,
}: LeftColumnProps) => (
  <div className="left-column">
    {!reading && review.sinceReview !== undefined && (
      <LastReview
        since={review.sinceReview}
        unasked={notes?.unasked}
        nodes={review.diff.nodes}
        findings={findings}
        onGoTo={onGoTo}
        onGoToDraft={onGoToDraft}
        onGoToOutside={onGoToOutside}
      />
    )}
    {reading ? (
      <ReadingStops
        review={review}
        read={read}
        current={selected}
        onGoTo={onGoTo}
        onShowOutside={onShowOutside}
      />
    ) : (
      <ReadingOrderList
        review={review}
        read={read}
        commentable={commentable}
        findings={findings}
        onGoTo={onWalkTo}
        onStart={onStart}
        onShowOutside={onShowOutside}
      />
    )}
    {!reading && (
      <FindingsRail
        findings={inLens}
        open={railOpen}
        onOpen={onRailOpen}
        review={review}
        onGoTo={onGoTo}
        onGoToFinding={onGoToFinding}
        onShowOutside={onShowOutside}
        onShowFile={onShowFile}
        answers={answers}
        onAnswer={onAnswer}
      />
    )}
  </div>
);

type OtherScreenProps = {
  readonly tab: Tab;
  readonly review: PageData;
  readonly notes: ReviewPageProps['notes'];
  readonly selected: DiffNode | undefined;
  readonly comments: Comments;
  readonly onComment: ((comment: Comment) => void) | undefined;
  readonly onGoTo: (id: string) => void;
  readonly schemaLanding: SchemaLanding | undefined;
  readonly onSchemaLanded: () => void;
  readonly routesLanding: RoutesLanding | undefined;
  readonly onRoutesLanded: () => void;
  readonly onShowPatch: (path: string, opener: HTMLButtonElement) => void;
};

const OtherScreen = ({
  tab,
  review,
  notes,
  selected,
  comments,
  onComment,
  onGoTo,
  schemaLanding,
  onSchemaLanded,
  routesLanding,
  onRoutesLanded,
  onShowPatch,
}: OtherScreenProps) => (
  <>
    {tab === 'metrics' && <MetricsScreen review={review} onGoTo={onGoTo} />}
    {tab === 'tests' && (
      <ChangedSinceMarks value={changedSinceIn(review)}>
        <TestsScreen
          review={review}
          notes={notes}
          selected={selected}
          onGoTo={onGoTo}
          comments={comments}
          onComment={onComment}
        />
      </ChangedSinceMarks>
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

const Page = ({ review, notes, send }: ReviewPageProps) => {
  const tab = useTab(review);
  const [layout, setLayout] = useState<Layout>();
  const [reading, setReading] = useState(false);
  const { frameElement, placed, frameProps, zoomAtCentre, fitToFrame, centre, pin } = useGraphView(
    layout,
    reading,
  );
  const [selected, setSelected] = useState<string>();
  const [commentAsked, setCommentAsked] = useState<{ readonly on: string }>();
  if (commentAsked !== undefined && (commentAsked.on !== selected || tab !== 'structure'))
    setCommentAsked(undefined);
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
  const visible = useMemo(() => visibleDiff({ diff: review.diff, expanded }), [review, expanded]);
  const [allEdges, setAllEdges] = useState(false);
  const noted = useMemo(() => new Set(Object.keys(notes?.notes ?? {})), [notes]);
  const scopes = useMemo(() => scopesOf(review), [review]);
  const [scope, setScope] = useState(CHANGES_ONLY);
  const [colouring, setColouring] = useState<Colouring>('change');
  const [picked, setPicked] = useState<Lens>();
  const [railOpen, setRailOpen] = useState(false);
  const [startHereOpen, setStartHereOpen] = useState(true);
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
    () => visibleNotes({ diff: review.diff, expanded, notes: notes?.notes ?? {} }),
    [review, notes, expanded],
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
  const visibleOf = visibleNodeOf({ diff: review.diff, expanded });
  const boxesAbove = boxesAboveIn(review.diff.nodes);
  const placedFindings = findingsAt({ diff: review.diff, expanded, findings });
  const numbers = new Map(review.readingOrder.parts.map((part, index) => [part, index + 1]));
  const drawing = {
    findingsOn: (id: string) => placedFindings.get(id) ?? [],
    numberOf: (id: string) => numbers.get(id),
    picked,
    notes: shown,
    onSelect: (id: string) => (reading ? goTo(id) : select(id)),
    register,
    expandable: reading ? NOTHING_EXPANDABLE : expandable,
    expanded,
    onToggle: toggle,
    inMap: reading,
    current: reading ? selected : undefined,
    scale: placed?.view.scale ?? 1,
    unroutedOf: (id: string) =>
      dangling.filter(call => visibleOf(call.from) === id).map(call => call.path),
    shadeOf: ({ id, state }: DiffedNode) =>
      shadeOf(colouring, {
        metrics: review.metrics[id],
        changed: state !== 'unchanged',
        kinds: review.symbols.flatMap(file =>
          (file.node === id || boxesAbove(file.node).includes(id)) && 'kind' in file
            ? [file.kind]
            : [],
        ),
      }),
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
    const opened = expandedToShow({ diff: review.diff, expanded, id });
    setExpanded(opened);
    const at = { diff: review.diff, expanded: opened, noted };
    const all = allEdges || !isDrawn({ diff: drawnAt({ ...at, allEdges: false }), id });
    if (all) setAllEdges(true);
    const atAll = drawnAt({ ...at, allEdges: all });
    const narrower = scopes.slice(scopes.indexOf(scope), -1);
    setScope(
      narrower.find(([, keep]) => isDrawn({ diff: keep({ ...at, drawn: atAll }), id })) ??
        EVERYTHING,
    );
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
  const goToFinding = (id: string, finding: string) => {
    landOn(id, { path: undefined, row: anchorKey({ kind: 'finding', id: finding }) });
    goTo(id);
  };
  const showOutsideAt = (place: LandingIn, opener: HTMLButtonElement) => {
    landOn(null, place);
    location.hash = '#structure';
    showOutside(opener);
  };
  const [schemaLanding, setSchemaLanding] = useState<SchemaLanding>();
  const [routesLanding, setRoutesLanding] = useState<RoutesLanding>();
  const showPatch = (path: string, opener: HTMLButtonElement) => {
    const holder = deepestHolding(path, review.diff.nodes);
    if (holder === undefined) {
      showOutsideAt({ path }, opener);
      return;
    }
    landOn(holder.id, { path });
    goToOnStructure(holder.id);
  };
  const showFile = (path: string, opener: HTMLButtonElement, place?: string) => {
    if (review.schemas.some(({ file }) => file === path)) {
      setSchemaLanding({ file: path, table: place });
      location.hash = '#schema';
      return;
    }
    if (routesHold(review.routes, path)) {
      setRoutesLanding({ file: path, route: place });
      location.hash = '#routes';
      return;
    }
    showPatch(path, opener);
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
      if (key === 'c' && selected !== undefined) {
        event.preventDefault();
        setCommentAsked({ on: selected });
      }
      if (key === 'a' && selected !== undefined && review.readingOrder.parts.includes(selected))
        toggleRead(selected);
    };
    document.addEventListener('keydown', keyed);
    return () => document.removeEventListener('keydown', keyed);
  });
  useEffect(() => {
    layoutDiff(drawn).then(setLayout);
  }, [drawn]);
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
        <LandingHead
          review={review}
          notes={notes}
          findings={findings}
          inLens={inLens}
          picked={picked}
          onPick={setPicked}
          onShowAll={() => setRailOpen(true)}
          startHereOpen={startHereOpen}
          onStartHereOpen={setStartHereOpen}
          onGoTo={goTo}
          onGoToFinding={goToFinding}
          onShowOutside={showOutside}
          onShowFile={showFile}
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
      {reading && selectedNode && (
        <NextToIt diff={review.diff} part={selectedNode.id} read={read} onGoTo={goTo} />
      )}
      {reading && findings.length > 0 && (
        <button type="button" className="all-findings" onClick={showAllFindings}>
          All findings
        </button>
      )}
    </div>
  );
  const side = (
    <ChangedSinceMarks key="side" value={changedSinceIn(review)}>
      <SidePanel
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
          expanded,
          noted: unmerged,
          allEdges,
        })}
        comments={comments}
        onComment={comment}
        answers={answers}
        onAnswer={answer}
        chosenWidth={chosenWidth}
        onChooseWidth={setChosenWidth}
        graphLeft={graphLeft}
        onCloseOutside={closeOutside}
        onCloseInspector={closeInspector}
        onGoTo={goTo}
        onWalkTo={walkTo}
        landing={landing}
        onLand={line => landOn(selected, line)}
        read={read}
        onToggleRead={toggleRead}
        commentAsked={commentAsked}
        heading={heading}
        reading={reading}
      />
    </ChangedSinceMarks>
  );
  const page = (
    <main>
      <Header review={review} tab={tab} read={read} />
      {tab === 'structure' && (
        <>
          {!reading && (
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
        comments={comments}
        onComment={comment}
        onGoTo={goToOnStructure}
        schemaLanding={schemaLanding}
        onSchemaLanded={() => setSchemaLanding(undefined)}
        routesLanding={routesLanding}
        onRoutesLanded={() => setRoutesLanding(undefined)}
        onShowPatch={showPatch}
      />
      {send && (
        <ReviewTray
          reviewed={{
            range: review.range,
            ...(review.pullRequest && { pullRequest: review.pullRequest.number }),
          }}
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
    <RespondingOnPage
      value={
        comment && {
          resolved,
          onResolve: said => setResolved(current => withResolveToggled(current, said)),
          comments,
          onComment: comment,
        }
      }
    >
      {page}
    </RespondingOnPage>
  );
};

export const ReviewPage = (props: ReviewPageProps) => (
  <LastSaidOnPage since={props.review.sinceReview} answers={props.notes?.answers}>
    <Page {...props} />
  </LastSaidOnPage>
);
