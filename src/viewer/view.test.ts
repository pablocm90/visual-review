import { expect, test } from 'vitest';
import type { Layout, PlacedNode } from './layout.ts';
import { fitted, frameHeight, panned, pinned, topLeftOf, zoomed } from './view.ts';

test.for([
  {
    graphIs: 'wider than the frame, fitted to its width and centred vertically',
    graph: { width: 2000, height: 400 },
    view: { scale: 0.5, x: 0, y: 200 },
  },
  {
    graphIs: 'taller than the frame, fitted to its height and centred horizontally',
    graph: { width: 500, height: 1200 },
    view: { scale: 0.5, x: 375, y: 0 },
  },
  {
    graphIs: 'smaller than the frame, kept at natural size and centred',
    graph: { width: 400, height: 200 },
    view: { scale: 1, x: 300, y: 200 },
  },
])('a graph $graphIs', ({ graph, view }) => {
  expect(fitted({ graph, frame: { width: 1000, height: 600 } })).toEqual(view);
});

test.for([
  {
    graphIs: 'wider than the frame takes its height at the scale fitting its width',
    graph: { width: 2000, height: 600 },
    height: 300,
  },
  {
    graphIs: 'narrower than the frame takes its natural height',
    graph: { width: 400, height: 300 },
    height: 300,
  },
  {
    graphIs: 'taller than the window takes the window less its padding',
    graph: { width: 1000, height: 1000 },
    height: 652,
  },
])('the frame for a graph $graphIs', ({ graph, height }) => {
  expect(frameHeight({ graph, frameWidth: 1000, windowHeight: 700 })).toBe(height);
});

const big = { graph: { width: 2000, height: 2000 }, frame: { width: 1000, height: 1000 } };

test.for([
  {
    zoomIs: 'keeps the graph point under the pointer where it was',
    scale: 2,
    at: { x: 100, y: 200 },
    view: { scale: 2, x: -1100, y: -1200 },
  },
  {
    zoomIs: 'stops at 400%',
    scale: 10,
    at: { x: 500, y: 500 },
    view: { scale: 4, x: -3500, y: -3500 },
  },
  {
    zoomIs: 'stops at the scale that fits the graph',
    scale: 0.1,
    at: { x: 500, y: 500 },
    view: { scale: 0.5, x: 0, y: 0 },
  },
  {
    zoomIs: 'shows no space past the edge of a graph bigger than the frame',
    scale: 0.6,
    at: { x: 1000, y: 1000 },
    view: { scale: 0.6, x: 0, y: 0 },
  },
])('zooming $zoomIs', ({ scale, at, view }) => {
  expect(zoomed({ ...big, view: { scale: 1, x: -500, y: -500 }, scale, at })).toEqual(view);
});

test('zooming centres a graph smaller than the frame on that axis', () => {
  expect(
    zoomed({
      graph: { width: 2000, height: 400 },
      frame: { width: 1000, height: 600 },
      view: { scale: 0.5, x: 0, y: 200 },
      scale: 1,
      at: { x: 0, y: 0 },
    }),
  ).toEqual({ scale: 1, x: 0, y: 100 });
});

test.for([
  {
    panIs: 'moves the graph by the pointer',
    by: { x: 40, y: -30 },
    view: { scale: 2, x: -460, y: -530 },
  },
  {
    panIs: 'stops at the edge of the graph',
    by: { x: 600, y: -3000 },
    view: { scale: 2, x: 0, y: -3000 },
  },
])('panning $panIs', ({ by, view }) => {
  expect(panned({ ...big, view: { scale: 2, x: -500, y: -500 }, by })).toEqual(view);
});

test.for([
  {
    pinIs: 'keeps the box where it was on screen, at the same zoom',
    to: { x: 300, y: 250 },
    view: { scale: 2, x: -700, y: -800 },
  },
  {
    pinIs: 'stops at the edge of the graph',
    to: { x: 1800, y: 250 },
    view: { scale: 2, x: -3000, y: -800 },
  },
])('pinning a toggled box $pinIs', ({ to, view }) => {
  expect(
    pinned({ ...big, view: { scale: 2, x: -500, y: -500 }, from: { x: 200, y: 100 }, to }),
  ).toEqual(view);
});

test('pinning a box after a relayout shrinks the graph keeps the zoom no lower than fits the new graph', () => {
  expect(
    pinned({
      graph: { width: 500, height: 500 },
      frame: { width: 1000, height: 1000 },
      view: { scale: 0.5, x: 0, y: 0 },
      from: { x: 200, y: 100 },
      to: { x: 200, y: 100 },
    }).scale,
  ).toBe(1);
});

const placed = (
  id: string,
  at: { readonly x: number; readonly y: number },
  children: ReadonlyArray<PlacedNode> = [],
): PlacedNode => ({
  id,
  kind: 'module',
  label: id,
  path: id,
  state: 'unchanged',
  ...at,
  width: 100,
  height: 50,
  children,
});

test("a box's top-left in the graph adds up the places of the stack and boxes it is drawn in", () => {
  const layout: Layout = {
    width: 1000,
    height: 1000,
    calls: [],
    stacks: [
      {
        ...placed('web', { x: 16, y: 20 }, [
          placed('web/module/app', { x: 24, y: 44 }),
          placed('web/module/utils', { x: 200, y: 44 }, [
            placed('web/file/utils/x.ts', { x: 16, y: 40 }),
          ]),
        ]),
        edges: [],
      },
      { ...placed('rust', { x: 500, y: 16 }), edges: [] },
    ],
  };

  expect(topLeftOf({ layout, id: 'web/file/utils/x.ts' })).toEqual({ x: 232, y: 104 });
  expect(topLeftOf({ layout, id: 'web' })).toEqual({ x: 16, y: 20 });
});
