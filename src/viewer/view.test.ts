import { expect, test } from 'vitest';
import { fitted, frameHeight, panned, zoomed } from './view.ts';

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
