type Size = { readonly width: number; readonly height: number };

export type View = { readonly scale: number; readonly x: number; readonly y: number };

const PAGE_PADDING = 48;

export const fitted = ({ graph, frame }: { readonly graph: Size; readonly frame: Size }): View => {
  const scale = Math.min(1, frame.width / graph.width, frame.height / graph.height);
  return {
    scale,
    x: (frame.width - graph.width * scale) / 2,
    y: (frame.height - graph.height * scale) / 2,
  };
};

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

export const zoomed = ({ graph, frame, view, scale, at }: ZoomedOptions): View => {
  const within = Math.min(MOST_ZOOMED, Math.max(fitted({ graph, frame }).scale, scale));
  const ratio = within / view.scale;
  return clamped({
    graph,
    frame,
    view: { scale: within, x: at.x - (at.x - view.x) * ratio, y: at.y - (at.y - view.y) * ratio },
  });
};
