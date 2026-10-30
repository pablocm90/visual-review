import { expect, test } from 'vitest';
import { fitted, frameHeight } from './view.ts';

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
