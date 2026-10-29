import { type KeyboardEvent, type PointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { FilePatch } from '../core/diff-graphs.ts';
import { isAtOrUnder } from '../core/diff-graphs.ts';
import type { Note, ReviewNotes } from '../core/notes.ts';
import type { ReviewData } from '../core/review-data.ts';
import { notReadLine } from '../core/skipped.ts';
import type { MarkedTest, TestChange, TestStatement } from '../core/test-changes.ts';
import {
  edgeId,
  nearChanges,
  visibleDiff,
  visibleNodeOf,
  visibleNotes,
} from '../core/visible-diff.ts';
import { highlightPatch, type PatchLine as Line, type Piece } from './highlight-patch.ts';
import {
  type Layout,
  layoutDiff,
  type PlacedEdge,
  type PlacedNode,
  type PlacedStack,
} from './layout.ts';

const STATES = ['added', 'removed', 'modified', 'unchanged'] as const;

const NOTE_WIDTH = 360;
const CHANGES_WIDTH = 600;
const PANEL_MIN = 280;
const GRAPH_MIN = 320;
const PAGE_PADDING_AND_DIVIDER = 72;
const DIVIDER_STEP = 40;

const panelWidthWithin = (width: number) =>
  Math.min(Math.max(width, PANEL_MIN), window.innerWidth - PAGE_PADDING_AND_DIVIDER - GRAPH_MIN);

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

const FlagBadge = ({ x, y }: { readonly x: number; readonly y: number }) => (
  <g className="flag-badge" transform={`translate(${x} ${y})`}>
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
  const { notes, onSelect, register, expandable, expanded, onToggle, unroutedOf } = drawing;
  const unrouted = unroutedOf(node.id);
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
          ].join(', '),
          note: notes[node.id],
          onSelect,
          register,
        })}
        className="node"
        data-state={node.state}
        transform={`translate(${node.x} ${node.y})`}
      >
        <title>{`${node.path} — ${node.state}`}</title>
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
        {notes[node.id]?.flag && <FlagBadge x={node.width} y={0} />}
        {unrouted.length > 0 && <FlagBadge x={node.width} y={node.height} />}
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
      {note?.flag && <FlagBadge {...middleOf(edge.points)} />}
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
  const flagged = Object.entries(notes.notes).flatMap(([id, note]) =>
    note.flag ? [{ text: `${note.flag}: ${note.text}`, target: id }] : [],
  );
  return (
    <section className="summary" aria-label="Summary">
      <ul>
        {[...notes.summary, ...flagged].map(({ text, target }) => (
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

export const ReviewPage = ({ review }: { readonly review: ReviewData }) => {
  const [layout, setLayout] = useState<Layout>();
  const [selected, setSelected] = useState<string>();
  const [chosenWidth, setChosenWidth] = useState<number>();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const expandable = useMemo(
    () => new Set(review.diff.nodes.flatMap(node => node.parent ?? [])),
    [review],
  );
  const visible = useMemo(() => visibleDiff({ diff: review.diff, expanded }), [review, expanded]);
  const [nearOnly, setNearOnly] = useState(false);
  const drawn = useMemo(() => (nearOnly ? nearChanges(visible) : visible), [visible, nearOnly]);
  const shown = useMemo(
    () => visibleNotes({ diff: review.diff, expanded, notes: review.notes?.notes ?? {} }),
    [review, expanded],
  );
  const toggle = (id: string) =>
    setExpanded(current =>
      current.has(id)
        ? new Set([...current].filter(other => other !== id))
        : new Set([...current, id]),
    );
  const elements = useRef(new Map<string, SVGElement | null>());
  const register = (id: string, element: SVGElement | null) => {
    elements.current.set(id, element);
  };
  const labelOf = new Map(visible.nodes.map(node => [node.id, node.label]));
  const dangling = review.dangling ?? [];
  const undrawn = review.undrawn ?? [];
  const visibleOf = visibleNodeOf({ diff: review.diff, expanded });
  const drawing = {
    notes: shown,
    onSelect: setSelected,
    register,
    expandable,
    expanded,
    onToggle: toggle,
    unroutedOf: (id: string) =>
      dangling.filter(call => visibleOf(call.from) === id).map(call => call.path),
  };
  const selectedNode = review.diff.nodes.find(node => node.id === selected);
  const patches = selectedNode
    ? (review.patches ?? []).filter(({ path }) => isAtOrUnder(path, selectedNode))
    : [];
  const panelWidth = chosenWidth ?? (patches.length > 0 ? CHANGES_WIDTH : NOTE_WIDTH);
  const moveDivider = (event: KeyboardEvent) => {
    const step = { ArrowLeft: DIVIDER_STEP, ArrowRight: -DIVIDER_STEP }[event.key];
    if (step === undefined) return;
    setChosenWidth(panelWidthWithin(panelWidth + step));
  };
  const dragDivider = (down: PointerEvent<HTMLDivElement>) => {
    down.preventDefault();
    down.currentTarget.focus();
    const follow = (move: globalThis.PointerEvent) =>
      setChosenWidth(panelWidthWithin(panelWidth + down.clientX - move.clientX));
    window.addEventListener('pointermove', follow);
    window.addEventListener('pointerup', () => window.removeEventListener('pointermove', follow), {
      once: true,
    });
  };
  const tests = (review.tests ?? []).filter(
    ({ path }) => selectedNode === undefined || isAtOrUnder(path, selectedNode),
  );
  const [focusTarget, setFocusTarget] = useState<string>();
  const goTo = (id: string) => {
    setSelected(id);
    const edge = review.diff.edges.find(other => edgeId(other) === id);
    const parents = (edge ? [edge.from, edge.to] : [id]).flatMap(
      end => review.diff.nodes.find(node => node.id === end)?.parent ?? [],
    );
    const opened = new Set([...expanded, ...parents]);
    setExpanded(opened);
    const near = nearChanges(visibleDiff({ diff: review.diff, expanded: opened }));
    if (![...near.nodes.map(node => node.id), ...near.edges.map(edgeId)].includes(id)) {
      setNearOnly(false);
    }
    setFocusTarget(id);
  };
  useEffect(() => {
    layoutDiff(drawn).then(setLayout);
  }, [drawn]);
  useEffect(() => {
    if (layout === undefined || focusTarget === undefined) return;
    const element = elements.current.get(focusTarget);
    if (element) {
      element.focus();
      setFocusTarget(undefined);
    }
  }, [layout, focusTarget]);
  return (
    <main>
      <header>
        {review.pullRequest && (
          <p className="pull-request">
            <a href={review.pullRequest.url}>
              PR #{review.pullRequest.number} {review.pullRequest.title}
            </a>
          </p>
        )}
        <h1>
          Structure{' '}
          <code>
            <ShortRange range={review.range} />
          </code>
        </h1>
        {review.skipped?.map(skip => (
          <p key={skip.reader} className="skipped" role="alert">
            {notReadLine(skip)}
          </p>
        ))}
        <Legend />
        <p className="caveat">Calls whose path is built at runtime are not drawn.</p>
      </header>
      <div className="columns">
        <div className="content">
          {review.notes && <Summary notes={review.notes} onGoTo={goTo} />}
          <label className="near-only">
            <input
              type="checkbox"
              checked={nearOnly}
              onChange={event => setNearOnly(event.target.checked)}
            />
            Changed + 1 hop
          </label>
          {drawn.nodes.length === 0 && <p className="caveat">Nothing in the graph changed.</p>}
          {layout && (
            <svg
              className="graph"
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              width={layout.width}
              height={layout.height}
            >
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
            </svg>
          )}
          {dangling.length > 0 && (
            <section className="unplaced" aria-label="Calls with no route">
              <h2>Calls with no route</h2>
              <ul>
                {dangling.map(call => (
                  <li key={`${call.from} ${call.path}`}>
                    <code>{call.path}</code> from{' '}
                    <code>{review.diff.nodes.find(node => node.id === call.from)?.path}</code>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className="tests" aria-label="Tests">
            <h2>Tests</h2>
            {review.notes && <p className="tests-line">{review.notes.tests}</p>}
            {tests.length === 0 ? (
              <p>{selectedNode ? 'No test changed here.' : 'No test changed.'}</p>
            ) : (
              tests.map(file => (
                <section key={file.path} aria-label={file.path}>
                  <h3>
                    <code>{file.path}</code>
                    {file.renamedFrom && (
                      <span className="renamed">renamed from {file.renamedFrom}</span>
                    )}
                  </h3>
                  {'statements' in file ? (
                    <TestTree statements={file.statements} />
                  ) : (
                    <p>Couldn't read its tests: {file.unreadable}</p>
                  )}
                </section>
              ))
            )}
          </section>
          {undrawn.length > 0 && (
            <section className="undrawn" aria-label="Not in the graph">
              <h2>Not in the graph</h2>
              {undrawn.map(patch => (
                <Patch key={patch.path} {...patch} open={false} />
              ))}
            </section>
          )}
        </div>
        {selected !== undefined && (
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
            <aside className="note" aria-label="Note" style={{ width: panelWidth }}>
              <p>{shown[selected]?.text ?? 'No note'}</p>
              {selectedNode?.renamedFrom !== undefined && (
                <p className="renamed">Renamed from {selectedNode.renamedFrom}</p>
              )}
              {patches.length > 0 && (
                <section className="changes" aria-label="Changes">
                  {patches.map(patch => (
                    <Patch key={patch.path} {...patch} open={selectedNode?.kind === 'file'} />
                  ))}
                </section>
              )}
            </aside>
          </>
        )}
      </div>
    </main>
  );
};
