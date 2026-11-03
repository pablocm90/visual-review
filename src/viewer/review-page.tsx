import {
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useEffectEvent,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { DiffedNode, FilePatch, GraphDiff } from '../core/diff-graphs.ts';
import { isAtOrUnder } from '../core/diff-graphs.ts';
import { type Dimension, type Finding, findingsAt, findingsOf } from '../core/findings.ts';
import { edgeId } from '../core/graph.ts';
import { type MetricFinding, metricFindings } from '../core/metric-findings.ts';
import type { NodeMetrics } from '../core/metrics.ts';
import { type Note, type ReviewNotes, visibleNotes } from '../core/notes.ts';
import { type PageData, UNCOMMITTED } from '../core/page.ts';
import type { SymbolFile } from '../core/read-range.ts';
import type { Review } from '../core/review.ts';
import type { TestFile } from '../core/test-changes.ts';
import { testsAlongside } from '../core/tests-alongside.ts';
import {
  boxesAboveIn,
  changesOnly,
  expandedToShow,
  isDrawn,
  mergedDiff,
  nearChanges,
  visibleDiff,
  visibleNodeOf,
} from '../core/visible-diff.ts';
import { ColourBy, type Colouring, ScaleLegend, type Shade, shadeOf } from './colour-by.tsx';
import { findingLine, LEVELS, LevelMark, worstOf } from './finding-display.tsx';
import { FindingsRail, LookFirst, nameOf, TriageStrip } from './findings-rail.tsx';
import { highlightPatch, type PatchLine as Line, type Piece } from './highlight-patch.ts';
import {
  type Layout,
  layoutDiff,
  type PlacedEdge,
  type PlacedNode,
  type PlacedStack,
} from './layout.ts';
import { MetricsScreen } from './metrics-screen.tsx';
import { MetricsTable } from './metrics-tab.tsx';
import { storedReadMarks, storeReadMarks } from './read-marks.ts';
import { partsRead, ReadingOrderList } from './reading-order-list.tsx';
import { changedSymbolCount, hasSymbolNews, type LineAt, SymbolsOf } from './symbols-tab.tsx';
import { changedCount, TestFiles, TestsScreen } from './tests-screen.tsx';
import {
  boxOf,
  centred,
  fitted,
  frameHeight,
  panned,
  pinned,
  resized,
  type Size,
  type View,
  zoomed,
} from './view.ts';

const STATES = ['added', 'removed', 'modified', 'unchanged'] as const;

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
};

const selectable = ({ id, name, note, onSelect, register }: SelectableOptions) => ({
  ...pressable(() => onSelect(id)),
  ref: (element: SVGElement | null) => register(id, element),
  role: 'button',
  tabIndex: 0,
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
  readonly picked: Dimension | undefined;
  readonly onPress?: () => void;
};

const FindingsBadge = ({ x, y, findings, picked, onPress }: FindingsBadgeProps) => {
  const outside = picked !== undefined && !findings.some(finding => finding.dimension === picked);
  const name = `${badgeName(findings)}${outside ? `, outside ${nameOf(picked)}` : ''}`;
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
  readonly picked: Dimension | undefined;
  readonly notes: Readonly<Record<string, Note>>;
  readonly onSelect: (id: string) => void;
  readonly register: (id: string, element: SVGElement | null) => void;
  readonly expandable: ReadonlySet<string>;
  readonly expanded: ReadonlySet<string>;
  readonly onToggle: (id: string) => void;
  readonly unroutedOf: (id: string) => ReadonlyArray<string>;
  readonly shadeOf: (node: DiffedNode) => Shade | undefined;
};

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
  const { notes, onSelect, register, expandable, expanded, onToggle, unroutedOf, shadeOf } =
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
          className="module"
          data-state={node.state}
          transform={`translate(${node.x} ${node.y})`}
        >
          <rect className="module-box" width={node.width} height={node.height} rx={8} />
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
        })}
        className="node"
        data-state={node.state}
        data-step={shade?.step}
        transform={`translate(${node.x} ${node.y})`}
      >
        <title>
          {`${node.path} — ${[node.state, ...(shade === undefined ? [] : [shade.name])].join(', ')}`}
        </title>
        <rect width={node.width} height={node.height} rx={6} />
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
  const { notes, onSelect, register, findingsOn } = drawing;
  const id = edgeId(edge);
  const note = notes[id];
  const found = findingsOn(id);
  return (
    <>
      <path
        {...selectable({ id, name, note, onSelect, register })}
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
          onPress={() => onSelect(id)}
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

const isFullSha = (ref: string) => /^[0-9a-f]{40}$/.test(ref);

const shortRef = (ref: string) => (isFullSha(ref) ? ref.slice(0, 7) : ref);

const endsOf = (range: string) => {
  const at = range.indexOf('..');
  return { from: range.slice(0, at), to: range.slice(at + 2) };
};

const shortRange = (range: string) => {
  const { from, to } = endsOf(range);
  return `${shortRef(from)}..${shortRef(to)}`;
};

const Ref = ({ name }: { readonly name: string }) =>
  isFullSha(name) ? <abbr title={name}>{shortRef(name)}</abbr> : name;

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

type Landing = Omit<LineAt, 'node'>;

const scrollInPanel = (element: HTMLElement, block: ScrollLogicalPosition) => {
  const { scrollX, scrollY } = window;
  element.scrollIntoView({ block });
  window.scrollTo(scrollX, scrollY);
};

const isLandedOn = (line: Line, landing: Landing | undefined): boolean =>
  landing !== undefined && line[landing.side] === landing.line;

const PatchLine = ({
  line: { kind, prefix, pieces },
  current,
}: {
  readonly line: Line;
  readonly current: boolean;
}) => {
  const landOn = useCallback(
    (row: HTMLElement | null) => {
      if (current && row) scrollInPanel(row, 'center');
    },
    [current],
  );
  const marks = { ref: landOn, 'aria-current': current || undefined };
  const code = (
    <>
      {prefix}
      {pieces.map((piece, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a line's pieces are fixed and may repeat
        <Scoped key={index} {...piece} />
      ))}
    </>
  );
  if (kind === 'added') return <ins {...marks}>{code}</ins>;
  if (kind === 'removed') return <del {...marks}>{code}</del>;
  return <span {...marks}>{code}</span>;
};

const Patch = ({
  path,
  patch,
  open,
  landing,
}: FilePatch & { readonly open: boolean; readonly landing?: Landing | undefined }) => {
  const lines = useMemo(() => highlightPatch({ path, patch }), [path, patch]);
  const landOnTop = useCallback(
    (top: HTMLElement | null) => {
      if (top && landing !== undefined && !lines.some(line => isLandedOn(line, landing)))
        scrollInPanel(top, 'start');
    },
    [landing, lines],
  );
  return (
    <details aria-label={path} open={open} ref={landOnTop}>
      <summary>{path}</summary>
      <pre>
        {lines.map((line, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a patch's lines are fixed and may repeat
          <PatchLine key={index} line={line} current={isLandedOn(line, landing)} />
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

const InspectorHead = ({
  nodes,
  node,
}: {
  readonly nodes: ReadonlyArray<DiffNode>;
  readonly node: DiffNode;
}) => (
  <header className="inspector-head">
    <p className="chips">
      <span>
        {node.kind} · {stackOf(nodes, node).label}
      </span>
      <span data-state={node.state}>{node.state}</span>
    </p>
    <h2>{node.label}</h2>
    <p className="path">
      {node.renamedFrom === undefined
        ? node.path
        : `${node.path}, renamed from ${node.renamedFrom}`}
    </p>
  </header>
);

type InspectorProps = {
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
  readonly comment: Draft;
  readonly onComment: ((draft: Draft) => void) | undefined;
  readonly commentable: boolean;
  readonly width: number;
  readonly onClose: () => void;
};

type Comment = Review['comments'][number];
type Draft = Pick<Comment, 'kind' | 'text'>;

const NO_DRAFT: Draft = { kind: 'question', text: '' };

const COMMENT_KINDS: ReadonlyArray<readonly [Comment['kind'], string]> = [
  ['change', 'Change this'],
  ['question', 'Question'],
  ['suggestion', 'Suggestion'],
];

type InspectorTab = 'note' | 'metrics' | 'diff' | 'tests' | 'symbols';

const INSPECTOR_TABS: Readonly<Record<InspectorTab, string>> = {
  note: 'Note',
  metrics: 'Metrics',
  diff: 'Diff',
  tests: 'Tests',
  symbols: 'Symbols',
};

type Section = {
  readonly tab: InspectorTab;
  readonly count?: number;
  readonly panel: ReactNode;
};

type NodeSectionsOptions = Pick<
  InspectorProps,
  'nodes' | 'metrics' | 'findings' | 'tests' | 'symbols' | 'onGoTo'
> & { readonly node: DiffNode; readonly onShowLine: (at: LineAt) => void };

const nodeSections = ({
  nodes,
  node,
  metrics,
  findings,
  tests,
  symbols,
  onGoTo,
  onShowLine,
}: NodeSectionsOptions): ReadonlyArray<Section> => {
  const measured = metrics[node.id];
  const testsHere = testsAlongside({ nodes, node, tests });
  const boxesAbove = boxesAboveIn(nodes);
  const symbolsHere = symbols.filter(
    file => file.node === node.id || boxesAbove(file.node).includes(node.id),
  );
  const symbolCount = changedSymbolCount(symbolsHere);
  return [
    ...(measured
      ? [
          {
            tab: 'metrics' as const,
            panel: (
              <MetricsTable
                metrics={measured}
                findings={findings.filter(finding => finding.node === node.id)}
              />
            ),
          },
        ]
      : []),
    ...(testsHere.length > 0
      ? [
          {
            tab: 'tests' as const,
            count: changedCount(testsHere),
            panel: (
              <div className="tests">
                <TestFiles files={testsHere} nodes={nodes} />
              </div>
            ),
          },
        ]
      : []),
    ...(symbolsHere.some(hasSymbolNews)
      ? [
          {
            tab: 'symbols' as const,
            ...(symbolCount > 0 && { count: symbolCount }),
            panel: (
              <div className="symbols">
                <SymbolsOf
                  node={node}
                  files={symbolsHere}
                  nodes={nodes}
                  onGoTo={onGoTo}
                  onShowLine={onShowLine}
                />
              </div>
            ),
          },
        ]
      : []),
  ];
};

type NotePanelProps = Pick<
  InspectorProps,
  'note' | 'found' | 'comment' | 'onComment' | 'commentable'
>;

const NotePanel = ({ note, found, comment, onComment, commentable }: NotePanelProps) => (
  <>
    {found.length > 0 && (
      <ul className="note-findings" aria-label="Findings">
        {found.map(finding => (
          <li key={finding.id}>
            <LevelMark level={finding.level} />
            {findingLine(finding)}
          </li>
        ))}
      </ul>
    )}
    <p>{note?.text ?? 'No note'}</p>
    {onComment &&
      (commentable ? (
        <>
          <div role="radiogroup" aria-label="Comment kind" className="comment-kind">
            {COMMENT_KINDS.map(([kind, label]) => (
              <label key={kind}>
                <input
                  type="radio"
                  name="comment-kind"
                  checked={comment.kind === kind}
                  onChange={() => onComment({ ...comment, kind })}
                />
                {label}
              </label>
            ))}
          </div>
          <label className="comment">
            Your comment
            <textarea
              value={comment.text}
              onChange={event => onComment({ ...comment, text: event.target.value })}
            />
          </label>
        </>
      ) : (
        <p>Drawn for several edges: open its ends to comment on one of them.</p>
      ))}
  </>
);

const SECTION_ORDER = Object.keys(INSPECTOR_TABS);

const Inspector = ({ node, patches, width, onClose, ...props }: InspectorProps) => {
  const [picked, setPicked] = useState<InspectorTab>('note');
  const [landing, setLanding] = useState<LineAt & { readonly path?: string | undefined }>();
  const [landedOn, setLandedOn] = useState(node?.id);
  if (landedOn !== node?.id) {
    setLandedOn(node?.id);
    setLanding(undefined);
  }
  const showLine = (at: LineAt) => {
    setLanding({ ...at, path: props.nodes.find(({ id }) => id === at.node)?.path });
    setPicked('diff');
  };
  const sections: ReadonlyArray<Section> = [
    { tab: 'note' as const, panel: <NotePanel {...props} /> },
    ...(patches.length > 0
      ? [
          {
            tab: 'diff' as const,
            panel: (
              <section className="changes" aria-label="Changes">
                {patches.map(patch => {
                  const landed = landing?.path === patch.path;
                  return (
                    <Patch
                      key={patch.path}
                      {...patch}
                      open={node?.kind === 'file' || landed}
                      landing={landed ? landing : undefined}
                    />
                  );
                })}
              </section>
            ),
          },
        ]
      : []),
    ...(node ? nodeSections({ ...props, node, onShowLine: showLine }) : []),
  ].toSorted((a, b) => SECTION_ORDER.indexOf(a.tab) - SECTION_ORDER.indexOf(b.tab));
  const shown = sections.find(({ tab }) => tab === picked) ?? sections[0];
  return (
    <aside className="note" aria-label="Inspector" style={{ width }}>
      <button type="button" className="close" aria-label="Close inspector" onClick={onClose}>
        ×
      </button>
      {node && <InspectorHead nodes={props.nodes} node={node} />}
      <div className="inspector-tabs" role="tablist" aria-label="Inspector sections">
        {sections.map(({ tab, count }) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={tab === shown?.tab}
            onClick={() => setPicked(tab)}
          >
            {INSPECTOR_TABS[tab]}
            {count !== undefined && ` ${count}`}
          </button>
        ))}
      </div>
      {shown && (
        <div role="tabpanel" aria-label={INSPECTOR_TABS[shown.tab]}>
          {shown.panel}
        </div>
      )}
    </aside>
  );
};

type OutsideFilesProps = {
  readonly patches: ReadonlyArray<FilePatch>;
  readonly width: number;
  readonly onClose: () => void;
};

const OutsideFiles = ({ patches, width, onClose }: OutsideFilesProps) => (
  <aside className="note" aria-label="Inspector" style={{ width }}>
    <button type="button" className="close" aria-label="Close inspector" onClick={onClose}>
      ×
    </button>
    <h2>Changed files outside the graph</h2>
    <section className="changes" aria-label="Changes">
      {patches.map(patch => (
        <Patch key={patch.path} {...patch} open={false} />
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
  readonly found: ReadonlyArray<Finding>;
  readonly comments: Comments;
  readonly onComment: ((comment: Comment) => void) | undefined;
  readonly chosenWidth: number | undefined;
  readonly onChooseWidth: (width: number) => void;
  readonly graphLeft: () => number;
  readonly onCloseOutside: () => void;
  readonly onCloseInspector: (id: string) => void;
  readonly onGoTo: (id: string) => void;
};

const SidePanel = ({
  review,
  selected,
  node,
  outside,
  note,
  found,
  comments,
  onComment,
  chosenWidth,
  onChooseWidth,
  graphLeft,
  onCloseOutside,
  onCloseInspector,
  onGoTo,
}: SidePanelProps) => {
  const patches = outside
    ? review.undrawn
    : node
      ? review.patches.filter(({ path }) => isAtOrUnder(path, node))
      : [];
  const width = chosenWidth ?? (patches.length > 0 ? CHANGES_WIDTH : NOTE_WIDTH);
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
  const divider = (
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
        <OutsideFiles patches={patches} width={width} onClose={onCloseOutside} />
      </>
    );
  }
  if (selected === undefined) return null;
  return (
    <>
      {divider}
      <Inspector
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
        comment={comments[selected] ?? NO_DRAFT}
        onComment={
          onComment &&
          (draft =>
            onComment({
              anchor: { kind: node === undefined ? 'edge' : 'part', id: selected },
              ...draft,
            }))
        }
        commentable={
          node !== undefined || review.diff.edges.some(edge => edgeId(edge) === selected)
        }
        width={width}
        onClose={() => onCloseInspector(selected)}
      />
    </>
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

type Keeping = {
  readonly diff: GraphDiff;
  readonly expanded: ReadonlySet<string>;
  readonly drawn: GraphDiff;
};

const SCOPES = [
  ['Changes only', changesOnly],
  ['Changed + 1 hop', ({ drawn }: Keeping) => nearChanges(drawn)],
  ['Everything', ({ drawn }: Keeping) => drawn],
] as const;

type Scope = (typeof SCOPES)[number];

type ShowProps = {
  readonly scope: Scope;
  readonly onPick: (scope: Scope) => void;
};

const Show = ({ scope, onPick }: ShowProps) => {
  const label = useId();
  return (
    <div className="graph-choice">
      <span id={label}>Show</span>
      <div role="group" aria-labelledby={label}>
        {SCOPES.map(each => (
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

const TABS = { structure: 'Structure', metrics: 'Metrics', tests: 'Tests' } as const;

type Tab = keyof typeof TABS;

const useGraphView = (layout: Layout | undefined) => {
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
          height: frameHeight({ graph: layout, frameWidth, windowHeight: window.innerHeight }),
        }
      : undefined;
  const [chosen, setChosen] = useState<Chosen>();
  const view = layout && frame && viewOn({ layout, frame, chosen });
  const placed = layout && frame && view && { graph: layout, frame, view };
  const choose = (next: (on: NonNullable<typeof placed>) => View, pin?: string) => {
    if (placed) setChosen({ of: placed.graph, view: next(placed), in: placed.frame, pin });
  };
  const dragged = useRef(false);
  const pan = (down: PointerEvent<HTMLDivElement>) => {
    dragged.current = false;
    if (down.button !== 0) return;
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
    if (!view || event.ctrlKey || event.metaKey || event.altKey) return;
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
    if (!frameElement || !placed) return;
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

const TAB_ORDER: ReadonlyArray<Tab> = ['structure', 'metrics', 'tests'];

const tabAt = (hash: string): Tab => TAB_ORDER.find(tab => `#${tab}` === hash) ?? 'structure';

const useTab = (): Tab => {
  const [tab, setTab] = useState(() => tabAt(location.hash));
  useEffect(() => {
    const follow = () => setTab(tabAt(location.hash));
    addEventListener('hashchange', follow);
    return () => removeEventListener('hashchange', follow);
  }, []);
  return tab;
};

type Comments = Readonly<Record<string, Comment>>;

type SendProps = {
  readonly reviewed: Review['reviewed'];
  readonly read: Review['read'];
  readonly parts: number;
  readonly comments: Comments;
  readonly send: (review: Review) => Promise<void>;
};

const VERDICTS: ReadonlyArray<readonly [Review['verdict'], string]> = [
  ['approve', 'Approve'],
  ['comment', 'Comment'],
  ['request-changes', 'Request changes'],
];

const SendToClaude = ({ reviewed, read, parts, comments, send }: SendProps) => {
  const [verdict, setVerdict] = useState<Review['verdict']>('comment');
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [sent, setSent] = useState(false);
  const [problem, setProblem] = useState<string>();
  const written = Object.values(comments).filter(({ text }) => text.trim() !== '');
  const hasBody = body.trim() !== '';
  const sendComments = () =>
    send({
      version: 3,
      verdict,
      ...(hasBody ? { body } : {}),
      reviewed,
      read,
      comments: written,
    }).then(
      () => setSent(true),
      (error: Error) => setProblem(error.message),
    );
  return (
    <div className="send-review">
      {sent ? (
        <p role="status" aria-label="Review">
          Sent
        </p>
      ) : (
        <>
          <button
            type="button"
            aria-expanded={open}
            aria-controls="review-panel"
            onClick={() => setOpen(wasOpen => !wasOpen)}
          >
            Review
          </button>
          {open && (
            <div id="review-panel" className="review-panel" role="group" aria-label="Review">
              {problem && (
                <p role="status" aria-label="Review" className="send-problem">
                  {problem}
                </p>
              )}
              <label className="general-comment">
                General comment
                <textarea value={body} onChange={event => setBody(event.target.value)} />
              </label>
              {parts > 0 && <p>{partsRead({ read: read.length, parts })}</p>}
              <div role="radiogroup" aria-label="Verdict" className="verdict">
                {VERDICTS.map(([value, label]) => (
                  <label key={value}>
                    <input
                      type="radio"
                      name="verdict"
                      checked={verdict === value}
                      onChange={() => setVerdict(value)}
                    />
                    {label}
                  </label>
                ))}
              </div>
              <button
                type="button"
                disabled={verdict !== 'approve' && written.length === 0 && !hasBody}
                onClick={sendComments}
              >
                Send to Claude
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

type HeaderProps = {
  readonly review: PageData;
  readonly tab: Tab;
  readonly read: Review['read'];
  readonly comments: Comments;
  readonly send: ((review: Review) => Promise<void>) | undefined;
};

const Header = ({ review, tab, read, comments, send }: HeaderProps) => {
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
      </div>
      <nav aria-label="Review">
        {TAB_ORDER.map(shown => (
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
      {send && (
        <SendToClaude
          reviewed={{
            range: review.range,
            ...(review.pullRequest && { pullRequest: review.pullRequest.number }),
          }}
          read={read}
          parts={review.readingOrder.parts.length}
          comments={comments}
          send={send}
        />
      )}
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

export const ReviewPage = ({ review, notes, send }: ReviewPageProps) => {
  const tab = useTab();
  const [layout, setLayout] = useState<Layout>();
  const { frameElement, placed, frameProps, zoomAtCentre, fitToFrame, centre, pin } =
    useGraphView(layout);
  const [selected, setSelected] = useState<string>();
  const [outside, setOutside] = useState(false);
  const outsideOpener = useRef<HTMLButtonElement>(null);
  const select = (id: string | undefined) => {
    setOutside(false);
    setSelected(id);
  };
  const [comments, setComments] = useState<Comments>({});
  const [chosenWidth, setChosenWidth] = useState<number>();
  const comment = (written: Comment) =>
    setComments(current => ({ ...current, [written.anchor.id]: written }));
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const expandable = useMemo(
    () => new Set(review.diff.nodes.flatMap(node => node.parent ?? [])),
    [review],
  );
  const visible = useMemo(() => visibleDiff({ diff: review.diff, expanded }), [review, expanded]);
  const [allEdges, setAllEdges] = useState(false);
  const noted = useMemo(() => new Set(Object.keys(notes?.notes ?? {})), [notes]);
  const [scope, setScope] = useState<Scope>(SCOPES[0]);
  const [colouring, setColouring] = useState<Colouring>('change');
  const [picked, setPicked] = useState<Dimension>();
  const [railOpen, setRailOpen] = useState(false);
  const findings = findingsOf({ data: review, notes });
  const triaged = findings.filter(finding => picked === undefined || finding.dimension === picked);
  const drawn = useMemo(() => {
    const [, keep] = scope;
    const atExpansion = drawnAt({ diff: review.diff, expanded, noted, allEdges });
    return keep({ diff: review.diff, expanded, drawn: atExpansion });
  }, [review, expanded, noted, allEdges, scope]);
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
    onSelect: select,
    register,
    expandable,
    expanded,
    onToggle: toggle,
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
    outsideOpener.current?.focus();
    setOutside(false);
  };
  const closeInspector = (id: string) => {
    elements.current.get(id)?.focus({ preventScroll: true });
    select(undefined);
  };

  const [focusTarget, setFocusTarget] = useState<string>();
  const goTo = (id: string) => {
    select(id);
    const opened = expandedToShow({ diff: review.diff, expanded, id });
    setExpanded(opened);
    const at = { diff: review.diff, expanded: opened, noted };
    const all = allEdges || !isDrawn({ diff: drawnAt({ ...at, allEdges: false }), id });
    if (all) setAllEdges(true);
    const atAll = drawnAt({ ...at, allEdges: all });
    const narrower = SCOPES.slice(SCOPES.indexOf(scope), -1);
    setScope(
      narrower.find(([, keep]) => isDrawn({ diff: keep({ ...at, drawn: atAll }), id })) ??
        SCOPES[2],
    );
    centre(id);
    setFocusTarget(id);
  };
  const goToOnStructure = (id: string) => {
    location.hash = '#structure';
    goTo(id);
  };
  const [read, setRead] = useState(() => storedReadMarks(review.range));
  useEffect(() => storeReadMarks(review.range, read), [review.range, read]);
  const walk = (step: number) => {
    const { parts } = review.readingOrder;
    const at = parts.indexOf(selected ?? '');
    const next = parts[Math.max(at + step, 0)];
    if (next !== undefined) goTo(next);
  };
  useEffect(() => {
    if (tab !== 'structure') return;
    const keyed = (event: globalThis.KeyboardEvent) => {
      if (event.target instanceof HTMLTextAreaElement) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === 'j') walk(1);
      if (key === 'k') walk(-1);
      if (key === 'a' && selected !== undefined && review.readingOrder.parts.includes(selected))
        setRead(current => toggled(current, selected));
    };
    document.addEventListener('keydown', keyed);
    return () => document.removeEventListener('keydown', keyed);
  });
  useEffect(() => {
    layoutDiff(drawn).then(setLayout);
  }, [drawn]);
  useEffect(() => {
    if (layout === undefined || focusTarget === undefined) return;
    const element = elements.current.get(focusTarget);
    if (element) {
      element.focus({ preventScroll: true });
      frameElement?.scrollIntoView({ block: 'nearest' });
      setFocusTarget(undefined);
    }
  }, [layout, focusTarget, frameElement]);
  return (
    <main>
      <Header
        review={review}
        tab={tab}
        read={review.readingOrder.parts.filter(part => read.has(part))}
        comments={comments}
        send={send}
      />
      {tab === 'structure' && (
        <>
          <div className="structure-head">
            <p className="caveat">Calls whose path is built at runtime are not drawn.</p>
          </div>
          <div className="columns">
            <div className="left-column">
              <ReadingOrderList
                review={review}
                read={read}
                findings={findings}
                onGoTo={goTo}
                onShowOutside={showOutside}
              />
              <FindingsRail
                findings={triaged}
                open={railOpen}
                onOpen={setRailOpen}
                review={review}
                onGoTo={goTo}
                onShowOutside={showOutside}
              />
            </div>
            <div className="content">
              {notes && notes.summary.length > 0 && <Summary notes={notes} onGoTo={goTo} />}
              <TriageStrip findings={findings} picked={picked} onPick={setPicked} />
              <LookFirst
                findings={triaged}
                onShowAll={() => setRailOpen(true)}
                review={review}
                onGoTo={goTo}
                onShowOutside={showOutside}
              />
              <div className="graph-controls">
                <ColourBy colouring={colouring} onPick={setColouring} />
                <div className="graph-filters">
                  <Show
                    scope={scope}
                    onPick={next => {
                      fitToFrame();
                      setScope(next);
                    }}
                  />
                  <label className="near-only">
                    <input
                      type="checkbox"
                      checked={allEdges}
                      onChange={event => {
                        fitToFrame();
                        setAllEdges(event.target.checked);
                      }}
                    />
                    All edges
                  </label>
                </div>
              </div>
              <div className="graph-key">
                {colouring === 'change' ? <Legend /> : <ScaleLegend colouring={colouring} />}
              </div>
              {drawn.nodes.length === 0 && <p className="caveat">Nothing in the graph changed.</p>}
              {layout && (
                <div
                  className="frame"
                  role="group"
                  aria-label="Graph"
                  // biome-ignore lint/a11y/noNoninteractiveTabindex: the frame takes the zoom and pan keys
                  tabIndex={0}
                  {...frameProps}
                >
                  {placed && (
                    <>
                      <Zoom scale={placed.view.scale} onZoom={zoomAtCentre} onFit={fitToFrame} />
                      <svg className="graph" data-colouring={colouring}>
                        <title>{`Structure ${shortRange(review.range)}`}</title>
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
                        <g
                          transform={`translate(${placed.view.x} ${placed.view.y}) scale(${placed.view.scale})`}
                        >
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
              )}
            </div>
            <SidePanel
              review={review}
              selected={selected}
              node={selectedNode}
              outside={outside}
              note={selectedNote}
              found={selectedFindings}
              comments={comments}
              onComment={send && comment}
              chosenWidth={chosenWidth}
              onChooseWidth={setChosenWidth}
              graphLeft={graphLeft}
              onCloseOutside={closeOutside}
              onCloseInspector={closeInspector}
              onGoTo={goTo}
            />
          </div>
        </>
      )}
      {tab === 'metrics' && <MetricsScreen review={review} onGoTo={goToOnStructure} />}
      {tab === 'tests' && (
        <TestsScreen
          review={review}
          notes={notes}
          selected={selectedNode}
          onGoTo={goToOnStructure}
        />
      )}
    </main>
  );
};
