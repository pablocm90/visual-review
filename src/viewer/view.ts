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
