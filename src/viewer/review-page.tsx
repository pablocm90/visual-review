import {
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { FilePatch, GraphDiff } from '../core/diff-graphs.ts';
import { isAtOrUnder } from '../core/diff-graphs.ts';
import { edgeId } from '../core/graph.ts';
import type { MetricFinding } from '../core/metric-findings.ts';
import type { NodeMetrics } from '../core/metrics.ts';
import { type Note, type ReviewNotes, visibleNotes } from '../core/notes.ts';
import { type PageData, UNCOMMITTED } from '../core/page.ts';
import type { MarkedTest, TestChange, TestFile, TestStatement } from '../core/test-changes.ts';
import {
  expandedToShow,
  isDrawn,
  mergedDiff,
  nearChanges,
  visibleDiff,
  visibleNodeOf,
} from '../core/visible-diff.ts';
import { ColourBy, type Colouring, ScaleLegend, type Shade, shadeOf } from './colour-by.tsx';
import { FindingsRail } from './findings-rail.tsx';
import { highlightPatch, type PatchLine as Line, type Piece } from './highlight-patch.ts';
import {
  type Layout,
  layoutDiff,
  type PlacedEdge,
  type PlacedNode,
  type PlacedStack,
} from './layout.ts';
import { MetricsTable } from './metrics-tab.tsx';
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

const flaggedFor = (flag: string) => `Flagged: ${flag}`;

const noRouteFor = (paths: ReadonlyArray<string>) => `No route for ${paths.join(', ')}`;

type FlagBadgeProps = {
  readonly x: number;
  readonly y: number;
  readonly reason: string;
  readonly onPress?: () => void;
};

const FlagBadge = ({ x, y, reason, onPress }: FlagBadgeProps) => (
  <g
    className="flag-badge"
    role="img"
    aria-label={reason}
    onClick={onPress}
    transform={`translate(${x} ${y})`}
  >
    <title>{reason}</title>
    <circle r={8} />
    <path d="M 0 -4.5 V 1 M 0 3.5 V 4" />
  </g>
);

type Drawing = {
  readonly notes: Readonly<Record<string, Note>>;
  readonly onSelect: (id: string) => void;
  readonly register: (id: string, element: SVGElement | null) => void;
  readonly expandable: ReadonlySet<string>;
  readonly expanded: ReadonlySet<string>;
  readonly onToggle: (id: string) => void;
  readonly unroutedOf: (id: string) => ReadonlyArray<string>;
  readonly shadeOf: (id: string) => Shade | undefined;
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
  const shade = shadeOf(node.id);
  const flag = notes[node.id]?.flag;
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
        {flag && <FlagBadge x={node.width} y={0} reason={flaggedFor(flag)} />}
        {unrouted.length > 0 && (
          <FlagBadge x={node.width} y={node.height} reason={noRouteFor(unrouted)} />
        )}
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
  const { notes, onSelect, register } = drawing;
  const id = edgeId(edge);
  const note = notes[id];
  return (
    <>
      <path
        {...selectable({ id, name, note, onSelect, register })}
        className={edge.via ? 'edge call' : 'edge'}
        data-state={edge.state}
        d={edgePath(edge.points)}
        markerEnd={`url(#arrow-${edge.state})`}
      />
      {note?.flag && (
        <FlagBadge
          {...middleOf(edge.points)}
          reason={flaggedFor(note.flag)}
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

const PatchLine = ({ line: { kind, prefix, pieces } }: { readonly line: Line }) => {
  const code = (
    <>
      {prefix}
      {pieces.map((piece, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a line's pieces are fixed and may repeat
        <Scoped key={index} {...piece} />
      ))}
    </>
  );
  if (kind === 'added') return <ins>{code}</ins>;
  if (kind === 'removed') return <del>{code}</del>;
  return <span>{code}</span>;
};

const Patch = ({ path, patch, open }: FilePatch & { readonly open: boolean }) => (
  <details aria-label={path} open={open}>
    <summary>{path}</summary>
    <pre>
      {highlightPatch({ path, patch }).map((line, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a patch's lines are fixed and may repeat
        <PatchLine key={index} line={line} />
      ))}
    </pre>
  </details>
);

const TEST_MARKS: Readonly<Record<TestChange, string>> = {
  added: '+',
  removed: '−',
  edited: '✎',
  unchanged: '·',
};

const accessibleName = (parts: ReadonlyArray<string | undefined>): string =>
  parts.filter(Boolean).join(', ');

const movement = ({ movedTo, movedFrom }: MarkedTest) => {
  if (movedTo !== undefined) return { mark: '↷', text: `moved to ${movedTo}` };
  if (movedFrom !== undefined) return { mark: '↶', text: `moved from ${movedFrom}` };
  return undefined;
};

const TestLine = ({ test }: { readonly test: MarkedTest }) => {
  const moved = movement(test);
  return (
    <li
      className="test"
      data-state={moved || test.change === 'edited' ? 'modified' : test.change}
      aria-label={accessibleName([`${test.name}: ${moved?.text ?? test.change}`, test.label])}
    >
      <span className="mark" aria-hidden="true">
        {moved?.mark ?? TEST_MARKS[test.change]}
      </span>
      {test.name}
      {test.label && <span className="label">{test.label}</span>}
      {moved && <span className="moved">{moved.text}</span>}
    </li>
  );
};

const TestTree = ({ statements }: { readonly statements: ReadonlyArray<TestStatement> }) => (
  <ul>
    {statements.map(statement =>
      statement.kind === 'test' ? (
        <TestLine key={`test ${statement.name} ${statement.change}`} test={statement} />
      ) : (
        <li
          key={`heading ${statement.name}`}
          className="heading"
          aria-label={accessibleName([statement.name, statement.label])}
        >
          <span>{statement.name}</span>
          {statement.label && <span className="label">{statement.label}</span>}
          <TestTree statements={statement.children} />
        </li>
      ),
    )}
  </ul>
);

const TestFiles = ({ files }: { readonly files: ReadonlyArray<TestFile> }) =>
  files.map(file => (
    <section key={file.path} aria-label={file.path}>
      <h3>
        <code>{file.path}</code>
        {file.renamedFrom && <span className="renamed">renamed from {file.renamedFrom}</span>}
      </h3>
      {'statements' in file ? (
        <TestTree statements={file.statements} />
      ) : (
        <p>Couldn't read its tests: {file.unreadable}</p>
      )}
    </section>
  ));

const changedTests = (statements: ReadonlyArray<TestStatement>): number =>
  statements.reduce(
    (count, statement) =>
      count +
      (statement.kind === 'heading'
        ? changedTests(statement.children)
        : Number(statement.change !== 'unchanged')),
    0,
  );

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
  readonly unrouted: ReadonlyArray<string>;
  readonly patches: ReadonlyArray<FilePatch>;
  readonly tests: ReadonlyArray<TestFile>;
  readonly width: number;
  readonly onClose: () => void;
};

type InspectorTab = 'note' | 'metrics' | 'diff' | 'tests';

const INSPECTOR_TABS: Readonly<Record<InspectorTab, string>> = {
  note: 'Note',
  metrics: 'Metrics',
  diff: 'Diff',
  tests: 'Tests',
};

const Inspector = ({
  nodes,
  node,
  metrics,
  findings,
  note,
  unrouted,
  patches,
  tests,
  width,
  onClose,
}: InspectorProps) => {
  const [picked, setPicked] = useState<InspectorTab>('note');
  const testsHere = node ? tests.filter(({ path }) => isAtOrUnder(path, node)) : [];
  const measured = node && metrics[node.id];
  const offered: ReadonlyArray<InspectorTab> = [
    'note',
    ...(measured ? ['metrics' as const] : []),
    ...(patches.length > 0 ? ['diff' as const] : []),
    ...(testsHere.length > 0 ? ['tests' as const] : []),
  ];
  const shown = offered.includes(picked) ? picked : 'note';
  const count = testsHere.reduce(
    (sum, file) => sum + ('statements' in file ? changedTests(file.statements) : 0),
    0,
  );
  return (
    <aside className="note" aria-label="Inspector" style={{ width }}>
      <button type="button" className="close" aria-label="Close inspector" onClick={onClose}>
        ×
      </button>
      {node && <InspectorHead nodes={nodes} node={node} />}
      <div className="inspector-tabs" role="tablist" aria-label="Inspector sections">
        {offered.map(tab => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={tab === shown}
            onClick={() => setPicked(tab)}
          >
            {INSPECTOR_TABS[tab]}
            {tab === 'tests' && ` ${count}`}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={INSPECTOR_TABS[shown]}>
        {shown === 'note' ? (
          <>
            {note?.flag && <h2>{flaggedFor(note.flag)}</h2>}
            {unrouted.length > 0 && <h2>{noRouteFor(unrouted)}</h2>}
            <p>{note?.text ?? 'No note'}</p>
          </>
        ) : shown === 'metrics' && measured ? (
          <MetricsTable
            metrics={measured}
            findings={findings.filter(finding => finding.node === node?.id)}
          />
        ) : shown === 'diff' ? (
          <section className="changes" aria-label="Changes">
            {patches.map(patch => (
              <Patch key={patch.path} {...patch} open={node?.kind === 'file'} />
            ))}
          </section>
        ) : (
          <TestFiles files={testsHere} />
        )}
      </div>
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

type DrawnAtOptions = {
  readonly diff: GraphDiff;
  readonly expanded: ReadonlySet<string>;
  readonly noted: ReadonlySet<string>;
  readonly allEdges: boolean;
};

const drawnAt = ({ diff, expanded, noted, allEdges }: DrawnAtOptions): GraphDiff =>
  allEdges ? visibleDiff({ diff, expanded }) : mergedDiff({ diff, expanded, noted });

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

const SHOWN_TABS: ReadonlyArray<Tab> = ['structure'];

const tabAt = (hash: string, shown: ReadonlyArray<Tab>): Tab =>
  shown.find(tab => `#${tab}` === hash) ?? 'structure';

const useTab = (shown: ReadonlyArray<Tab>): Tab => {
  const [tab, setTab] = useState(() => tabAt(location.hash, shown));
  useEffect(() => {
    const follow = () => setTab(tabAt(location.hash, shown));
    addEventListener('hashchange', follow);
    return () => removeEventListener('hashchange', follow);
  }, [shown]);
  return tab;
};

type HeaderProps = {
  readonly review: PageData;
  readonly tab: Tab;
  readonly shownTabs: ReadonlyArray<Tab>;
};

const Header = ({ review, tab, shownTabs }: HeaderProps) => (
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
      {shownTabs.map(shown => (
        <a key={shown} href={`#${shown}`} aria-current={shown === tab ? 'page' : undefined}>
          {TABS[shown]}
        </a>
      ))}
    </nav>
  </header>
);

type ReviewPageProps = {
  readonly review: PageData;
  readonly notes?: ReviewNotes | undefined;
  readonly shownTabs?: ReadonlyArray<Tab>;
};

export const ReviewPage = ({ review, notes, shownTabs = SHOWN_TABS }: ReviewPageProps) => {
  const tab = useTab(shownTabs);
  const [layout, setLayout] = useState<Layout>();
  const [selected, setSelected] = useState<string>();
  const [outside, setOutside] = useState(false);
  const select = (id: string | undefined) => {
    setOutside(false);
    setSelected(id);
  };
  const [chosenWidth, setChosenWidth] = useState<number>();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const expandable = useMemo(
    () => new Set(review.diff.nodes.flatMap(node => node.parent ?? [])),
    [review],
  );
  const visible = useMemo(() => visibleDiff({ diff: review.diff, expanded }), [review, expanded]);
  const [allEdges, setAllEdges] = useState(false);
  const noted = useMemo(() => new Set(Object.keys(notes?.notes ?? {})), [notes]);
  const [nearOnly, setNearOnly] = useState(true);
  const [colouring, setColouring] = useState<Colouring>('change');
  const drawn = useMemo(() => {
    const atExpansion = drawnAt({ diff: review.diff, expanded, noted, allEdges });
    return nearOnly ? nearChanges(atExpansion) : atExpansion;
  }, [review, expanded, noted, allEdges, nearOnly]);
  const shown = useMemo(
    () => visibleNotes({ diff: review.diff, expanded, notes: notes?.notes ?? {} }),
    [review, notes, expanded],
  );
  const toggle = (id: string) => {
    choose(on => on.view, id);
    setExpanded(current =>
      current.has(id)
        ? new Set([...current].filter(other => other !== id))
        : new Set([...current, id]),
    );
  };
  const elements = useRef(new Map<string, SVGElement | null>());
  const register = (id: string, element: SVGElement | null) => {
    elements.current.set(id, element);
  };
  const labelOf = new Map(visible.nodes.map(node => [node.id, node.label]));
  const dangling = review.dangling;
  const visibleOf = visibleNodeOf({ diff: review.diff, expanded });
  const drawing = {
    notes: shown,
    onSelect: select,
    register,
    expandable,
    expanded,
    onToggle: toggle,
    unroutedOf: (id: string) =>
      dangling.filter(call => visibleOf(call.from) === id).map(call => call.path),
    shadeOf: (id: string) => shadeOf(colouring, review.metrics[id]),
  };
  const selectedNode = review.diff.nodes.find(node => node.id === selected);
  const selectedNote = selected === undefined ? undefined : shown[selected];
  const selectedUnrouted = selected === undefined ? [] : drawing.unroutedOf(selected);
  const patches = outside
    ? review.undrawn
    : selectedNode
      ? review.patches.filter(({ path }) => isAtOrUnder(path, selectedNode))
      : [];
  const panelWidth = chosenWidth ?? (patches.length > 0 ? CHANGES_WIDTH : NOTE_WIDTH);
  const graphLeft = () => frameElement?.getBoundingClientRect().left ?? 0;
  const moveDivider = (event: KeyboardEvent) => {
    const step = { ArrowLeft: DIVIDER_STEP, ArrowRight: -DIVIDER_STEP }[event.key];
    if (step === undefined) return;
    setChosenWidth(panelWidthWithin(panelWidth + step, graphLeft()));
  };
  const dragDivider = (down: PointerEvent<HTMLDivElement>) => {
    down.preventDefault();
    down.currentTarget.focus();
    const follow = (move: globalThis.PointerEvent) =>
      setChosenWidth(panelWidthWithin(panelWidth + down.clientX - move.clientX, graphLeft()));
    window.addEventListener('pointermove', follow);
    window.addEventListener('pointerup', () => window.removeEventListener('pointermove', follow), {
      once: true,
    });
  };
  const tests = review.tests.filter(
    ({ path }) => selectedNode === undefined || isAtOrUnder(path, selectedNode),
  );
  const [focusTarget, setFocusTarget] = useState<string>();
  const goTo = (id: string) => {
    select(id);
    const opened = expandedToShow({ diff: review.diff, expanded, id });
    setExpanded(opened);
    const at = { diff: review.diff, expanded: opened, noted };
    const all = allEdges || !isDrawn({ diff: drawnAt({ ...at, allEdges: false }), id });
    if (all) setAllEdges(true);
    if (!isDrawn({ diff: nearChanges(drawnAt({ ...at, allEdges: all })), id })) {
      setNearOnly(false);
    }
    setChosen({ centre: id });
    setFocusTarget(id);
  };
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
  const keyed = (event: KeyboardEvent) => {
    if (!view || event.ctrlKey || event.metaKey || event.altKey) return;
    const panBy = (x: number, y: number) => () => choose(on => panned({ ...on, by: { x, y } }));
    const act = {
      '+': () => zoomAtCentre(view.scale * ZOOM_STEP),
      '=': () => zoomAtCentre(view.scale * ZOOM_STEP),
      '-': () => zoomAtCentre(view.scale / ZOOM_STEP),
      '1': () => zoomAtCentre(1),
      '0': () => setChosen(undefined),
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
      <Header review={review} tab={tab} shownTabs={shownTabs} />
      {tab === 'structure' && (
        <>
          <div className="structure-head">
            <p className="caveat">Calls whose path is built at runtime are not drawn.</p>
          </div>
          <div className="columns">
            <FindingsRail
              notes={notes}
              review={review}
              onGoTo={goTo}
              onShowOutside={() => {
                setSelected(undefined);
                setOutside(true);
              }}
            />
            <div className="content">
              {notes && notes.summary.length > 0 && <Summary notes={notes} onGoTo={goTo} />}
              <div className="graph-controls">
                <ColourBy colouring={colouring} onPick={setColouring} />
                <div className="graph-filters">
                  <label className="near-only">
                    <input
                      type="checkbox"
                      checked={nearOnly}
                      onChange={event => {
                        setChosen(undefined);
                        setNearOnly(event.target.checked);
                      }}
                    />
                    Changed + 1 hop
                  </label>
                  <label className="near-only">
                    <input
                      type="checkbox"
                      checked={allEdges}
                      onChange={event => {
                        setChosen(undefined);
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
                  ref={setFrameElement}
                  style={{ height: frame?.height }}
                  // biome-ignore lint/a11y/noNoninteractiveTabindex: the frame takes the zoom and pan keys
                  tabIndex={0}
                  onKeyDown={keyed}
                  onPointerDown={pan}
                  onClickCapture={event => {
                    if (dragged.current && event.detail > 0) event.stopPropagation();
                  }}
                >
                  {frame && view && (
                    <>
                      <Zoom
                        scale={view.scale}
                        onZoom={zoomAtCentre}
                        onFit={() => setChosen(undefined)}
                      />
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
                        <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
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
              <section className="tests" aria-label="Tests">
                <h2>Tests</h2>
                {notes && <p className="tests-line">{notes.tests}</p>}
                {tests.length === 0 ? (
                  <p>{selectedNode ? 'No test changed here.' : 'No test changed.'}</p>
                ) : (
                  <TestFiles files={tests} />
                )}
              </section>
            </div>
            {(selected !== undefined || outside) && (
              <>
                <div
                  className="divider"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Panel width"
                  aria-valuenow={panelWidth}
                  tabIndex={0}
                  onKeyDown={moveDivider}
                  onPointerDown={dragDivider}
                />
                {outside ? (
                  <OutsideFiles
                    patches={patches}
                    width={panelWidth}
                    onClose={() => setOutside(false)}
                  />
                ) : (
                  <Inspector
                    nodes={review.diff.nodes}
                    node={selectedNode}
                    metrics={review.metrics}
                    findings={review.metricFindings}
                    note={selectedNote}
                    unrouted={selectedUnrouted}
                    patches={patches}
                    tests={review.tests}
                    width={panelWidth}
                    onClose={() => {
                      if (selected !== undefined)
                        elements.current.get(selected)?.focus({ preventScroll: true });
                      select(undefined);
                    }}
                  />
                )}
              </>
            )}
          </div>
        </>
      )}
    </main>
  );
};
