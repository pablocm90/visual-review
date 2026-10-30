import { edgeId } from '../core/graph.ts';
import type { Layout, PlacedNode } from './layout.ts';

export type Size = { readonly width: number; readonly height: number };

export type View = { readonly scale: number; readonly x: number; readonly y: number };

const PAGE_PADDING = 48;

export const fitted = ({ graph, frame }: { readonly graph: Size; readonly frame: Size }): View =>
  centred({ graph, frame, box: { x: 0, y: 0, ...graph } });

type FrameHeightOptions = {
  readonly graph: Size;
  readonly frameWidth: number;
  readonly windowHeight: number;
};

export const frameHeight = ({ graph, frameWidth, windowHeight }: FrameHeightOptions): number =>
  Math.min(graph.height * Math.min(1, frameWidth / graph.width), windowHeight - PAGE_PADDING);

type Point = { readonly x: number; readonly y: number };

const MOST_ZOOMED = 4;

type Placed = { readonly graph: Size; readonly frame: Size; readonly view: View };

const clampedOn = (graph: number, frame: number, offset: number) =>
  graph > frame ? Math.min(0, Math.max(frame - graph, offset)) : (frame - graph) / 2;

const clamped = ({ graph, frame, view }: Placed): View => ({
  scale: view.scale,
  x: clampedOn(graph.width * view.scale, frame.width, view.x),
  y: clampedOn(graph.height * view.scale, frame.height, view.y),
});

type ZoomedOptions = Placed & { readonly scale: number; readonly at: Point };

const bounded = ({ graph, frame, scale }: Omit<Placed, 'view'> & { readonly scale: number }) =>
  Math.min(MOST_ZOOMED, Math.max(fitted({ graph, frame }).scale, scale));

export const zoomed = ({ graph, frame, view, scale, at }: ZoomedOptions): View => {
  const within = bounded({ graph, frame, scale });
  const ratio = within / view.scale;
  return clamped({
    graph,
    frame,
    view: { scale: within, x: at.x - (at.x - view.x) * ratio, y: at.y - (at.y - view.y) * ratio },
  });
};

export const panned = ({ graph, frame, view, by }: Placed & { readonly by: Point }): View =>
  clamped({ graph, frame, view: { scale: view.scale, x: view.x + by.x, y: view.y + by.y } });

export const resized = ({ graph, frame, view, from }: Placed & { readonly from: Size }): View =>
  clamped({
    graph,
    frame,
    view: {
      scale: bounded({ graph, frame, scale: view.scale }),
      x: view.x + (frame.width - from.width) / 2,
      y: view.y + (frame.height - from.height) / 2,
    },
  });

type PinnedOptions = Placed & { readonly from: Point; readonly to: Point };

export const pinned = ({ graph, frame, view, from, to }: PinnedOptions): View => {
  const scale = bounded({ graph, frame, scale: view.scale });
  return clamped({
    graph,
    frame,
    view: {
      scale,
      x: view.x + from.x * view.scale - to.x * scale,
      y: view.y + from.y * view.scale - to.y * scale,
    },
  });
};

type Box = Point & Size;

export const centred = ({ graph, frame, box }: Omit<Placed, 'view'> & { readonly box: Box }) => {
  const scale = Math.min(1, frame.width / box.width, frame.height / box.height);
  return clamped({
    graph,
    frame,
    view: {
      scale,
      x: frame.width / 2 - (box.x + box.width / 2) * scale,
      y: frame.height / 2 - (box.y + box.height / 2) * scale,
    },
  });
};

const boxIn = (nodes: ReadonlyArray<PlacedNode>, id: string, offset: Point): Box | undefined =>
  nodes.reduce<Box | undefined>((found, node) => {
    const at = { x: offset.x + node.x, y: offset.y + node.y };
    return (
      found ??
      (node.id === id
        ? { ...at, width: node.width, height: node.height }
        : boxIn(node.children, id, at))
    );
  }, undefined);

const ORIGIN = { x: 0, y: 0 };

const span = (points: ReadonlyArray<Point>, offset: Point): Box => {
  const xs = points.map(point => point.x);
  const ys = points.map(point => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x: offset.x + x,
    y: offset.y + y,
    width: Math.max(...xs) - x,
    height: Math.max(...ys) - y,
  };
};

const edgesIn = (layout: Layout) => [
  ...layout.calls.map(edge => ({ edge, offset: ORIGIN })),
  ...layout.stacks.flatMap(stack => stack.edges.map(edge => ({ edge, offset: stack }))),
];

export const boxOf = ({ layout, id }: { readonly layout: Layout; readonly id: string }) => {
  const drawn = edgesIn(layout).find(({ edge }) => edgeId(edge) === id);
  return boxIn(layout.stacks, id, ORIGIN) ?? (drawn && span(drawn.edge.points, drawn.offset));
};
