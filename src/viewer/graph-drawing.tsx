import type { KeyboardEvent } from 'react';
import type { DiffedNode } from '../core/diff-graphs.ts';
import type { Finding } from '../core/findings.ts';
import { edgeId } from '../core/graph.ts';
import type { Note } from '../core/notes.ts';
import type { Colouring, Shade } from './colour-by.tsx';
import { findingLine, LEVELS, worstOf } from './finding-display.tsx';
import type { useGraphView } from './graph-view.tsx';
import type { Layout, PlacedEdge, PlacedNode, PlacedStack } from './layout.ts';
import { LENS_OF, type Lens } from './lenses.ts';
import { type LogicCard, LogicCardBody } from './logic-card.tsx';
import { Ref, shortRef } from './ref.tsx';
import { endsOf } from './review-page.tsx';
import { ringAround } from './view.ts';

const STATES = ['added', 'removed', 'modified', 'unchanged'] as const;

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
  readonly cards: ReadonlyMap<string, LogicCard>;
  readonly onTick: (node: string, decision: string) => void;
  readonly openedCards: ReadonlySet<string>;
  readonly onOpenCard: (node: string) => void;
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
  const card = drawing.cards.get(node.id);
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
        {card ? (
          <LogicCardBody
            card={card}
            label={node.label}
            formerLabel={node.formerLabel}
            width={node.width}
            onTick={inMap ? undefined : decision => drawing.onTick(node.id, decision)}
            onOpen={inMap ? undefined : () => drawing.onOpenCard(node.id)}
            opened={drawing.openedCards.has(node.id)}
          />
        ) : (
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
        )}
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

export const ZOOM_STEP = 1.25;

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
      Actual size
    </button>
  </div>
);

const shortRange = (range: string) => {
  const { from, to } = endsOf(range);
  return `${shortRef(from)}..${shortRef(to)}`;
};

export const ShortRange = ({ range }: { readonly range: string }) => {
  const { from, to } = endsOf(range);
  return (
    <>
      <Ref name={from} />
      ..
      <Ref name={to} />
    </>
  );
};

export const Legend = () => (
  <ul className="legend" aria-label="Legend">
    {STATES.map(state => (
      <li key={state} data-state={state}>
        <span className="swatch" aria-hidden="true" />
        {state}
      </li>
    ))}
  </ul>
);

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

export const GraphFrame = ({
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
