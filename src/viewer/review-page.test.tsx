// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, onTestFinished, test, vi } from 'vitest';
import type { GraphDiff } from '../core/diff-graphs.ts';
import type { ReviewNotes } from '../core/notes.ts';
import type { PageData } from '../core/page.ts';
import { measured, pageWith } from '../test-support/page-data.ts';
import { layoutDiff } from './layout.ts';
import { ReviewPage } from './review-page.tsx';

const frameOfWidth = (width: number) => {
  const observing: { report?: (width: number) => void } = {};
  const Observer = class implements ResizeObserver {
    readonly #report: ResizeObserverCallback;
    constructor(report: ResizeObserverCallback) {
      this.#report = report;
    }
    observe(target: Element) {
      observing.report = (width: number) =>
        this.#report(
          [
            {
              target,
              contentRect: DOMRectReadOnly.fromRect({ width }),
              borderBoxSize: [],
              contentBoxSize: [],
              devicePixelContentBoxSize: [],
            },
          ],
          this,
        );
      observing.report(width);
    }
    unobserve() {}
    disconnect() {}
  };
  return { Observer, resize: (to: number) => act(() => observing.report?.(to)) };
};

const WIDE_FRAME = 1200;

vi.stubGlobal('ResizeObserver', frameOfWidth(WIDE_FRAME).Observer);

const scrolledIntoView = vi.fn();

Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: scrolledIntoView });

type Diffed = GraphDiff['nodes'][number]['state'];

const crate = (name: string, state: Diffed) => ({
  id: `rust/crate/${name}`,
  kind: 'package' as const,
  label: name,
  parent: 'rust',
  path: `crates/${name}`,
  state,
});

const dependency = (from: string, to: string, state: GraphDiff['edges'][number]['state']) => ({
  from: `rust/crate/${from}`,
  to: `rust/crate/${to}`,
  state,
});

const review = {
  range: 'abc123..def456',
  diff: {
    nodes: [
      { id: 'rust', kind: 'stack' as const, label: 'rust', path: '', state: 'unchanged' as const },
      crate('domain', 'unchanged'),
      crate('application', 'modified'),
      crate('cli-adapter', 'added'),
      crate('legacy', 'removed'),
    ],
    edges: [
      dependency('application', 'domain', 'unchanged'),
      dependency('cli-adapter', 'application', 'added'),
      dependency('legacy', 'domain', 'removed'),
    ],
  },
};

const showEverything = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('checkbox', { name: 'Changed + 1 hop' }));

const inspector = () => screen.getByRole('complementary', { name: 'Inspector' });

const noteTab = () => screen.getByRole('tabpanel', { name: 'Note' });

const noteShown = () => within(noteTab()).getAllByRole('paragraph')[0]?.textContent;

const inspectorTabs = () =>
  within(inspector())
    .queryAllByRole('tab')
    .map(tab => tab.textContent);

const reasonsShown = () =>
  within(noteTab())
    .queryAllByRole('heading')
    .map(heading => heading.textContent);

test('draws every crate and dependency inside the rust stack with its change state, and opens no inspector until one is clicked, closing it again from its close button, which hands the keyboard focus back to the node', async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={pageWith(review)} />);

  const rust = await screen.findByRole('group', { name: 'rust' });
  expect(screen.getAllByRole('group')).toEqual([
    screen.getByRole('group', { name: 'Colour by' }),
    screen.getByRole('group', { name: 'Graph' }),
    rust,
  ]);
  const drawn = within(rust).getAllByRole('button');
  expect(drawn).toHaveLength(7);
  [
    'domain: unchanged',
    'application: modified',
    'cli-adapter: added',
    'legacy: removed',
    'application → domain: unchanged',
    'cli-adapter → application: added',
    'legacy → domain: removed',
  ].forEach(name => {
    expect(drawn).toContain(within(rust).getByRole('button', { name }));
  });
  expect(screen.queryByRole('complementary', { name: 'Inspector' })).toBeNull();
  expect(screen.queryByRole('region', { name: 'Summary' })).toBeNull();

  const legacy = within(rust).getByRole('button', { name: 'legacy: removed' });
  await user.click(legacy);
  expect(noteShown()).toBe('No note');
  expect(within(inspector()).getByText('crates/legacy')).not.toBeNull();
  await user.click(within(inspector()).getByRole('button', { name: 'Close inspector' }));
  expect(screen.queryByRole('complementary', { name: 'Inspector' })).toBeNull();
  expect(document.activeElement).toBe(legacy);
});

test("the Note tab's comment field holds a comment per node or edge, kept while others are selected and the inspector closed", async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={pageWith(review)} />);
  const comment = () => within(noteTab()).getByRole('textbox', { name: 'Your comment' });

  const rust = await screen.findByRole('group', { name: 'rust' });
  await user.click(within(rust).getByRole('button', { name: 'domain: unchanged' }));
  await user.type(comment(), 'Keep domain free of IO.');
  await user.click(within(rust).getByRole('button', { name: 'application → domain: unchanged' }));
  expect(comment()).toHaveProperty('value', '');
  await user.type(comment(), 'Why this way round?');
  await user.click(within(inspector()).getByRole('button', { name: 'Close inspector' }));

  await user.click(within(rust).getByRole('button', { name: 'domain: unchanged' }));
  expect(comment()).toHaveProperty('value', 'Keep domain free of IO.');
  await user.click(within(rust).getByRole('button', { name: 'application → domain: unchanged' }));
  expect(comment()).toHaveProperty('value', 'Why this way round?');
});

test("a served page's Send to Claude sends each comment under its node's id or its edge's, then says it was sent", async () => {
  const user = userEvent.setup();
  const sent = vi.fn(async () => {});
  render(<ReviewPage review={pageWith(review)} send={sent} />);
  const comment = () => within(noteTab()).getByRole('textbox', { name: 'Your comment' });

  const rust = await screen.findByRole('group', { name: 'rust' });
  await user.click(within(rust).getByRole('button', { name: 'domain: unchanged' }));
  await user.type(comment(), 'Keep domain free of IO.');
  await user.click(within(rust).getByRole('button', { name: 'application → domain: unchanged' }));
  await user.type(comment(), 'Why this way round?');
  await user.click(screen.getByRole('button', { name: 'Send to Claude' }));

  expect(sent).toHaveBeenCalledExactlyOnceWith({
    version: 1,
    comments: {
      'rust/crate/domain': { text: 'Keep domain free of IO.' },
      'rust/crate/application -> rust/crate/domain': { text: 'Why this way round?' },
    },
  });
  expect((await screen.findByRole('status', { name: 'Review' })).textContent).toBe('Sent');
  expect(screen.queryByRole('button', { name: 'Send to Claude' })).toBeNull();
});

type FrameOptions = {
  readonly width: number;
  readonly windowHeight: number;
  readonly notes?: ReviewNotes;
};

const renderInFrame = (page: PageData, { width, windowHeight, notes }: FrameOptions) => {
  const frame = frameOfWidth(width);
  vi.stubGlobal('ResizeObserver', frame.Observer);
  const innerHeight = vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(windowHeight);
  onTestFinished(() => {
    vi.stubGlobal('ResizeObserver', frameOfWidth(WIDE_FRAME).Observer);
    innerHeight.mockRestore();
  });
  return { ...render(<ReviewPage review={page} notes={notes} />), resize: frame.resize };
};

const zoomShown = () => screen.getByRole('status', { name: 'Zoom' }).textContent;

const viewOf = (stack: HTMLElement) => stack.parentElement?.getAttribute('transform');

test.for([
  { frameIs: 'half the graph wide', widthTimes: 0.5, window: 'tall', xTimes: 0 },
  { frameIs: 'twice the graph wide', widthTimes: 2, window: 'half the graph high', xTimes: 0.75 },
])(
  'in a frame $frameIs and a window $window, the graph opens fitted at 50%, centred in a frame as high as the graph fitted to its width within the window',
  async ({ widthTimes, window, xTimes }) => {
    const graph = await layoutDiff(review.diff);
    renderInFrame(pageWith(review), {
      width: graph.width * widthTimes,
      windowHeight: window === 'tall' ? 10_000 : graph.height / 2 + 48,
    });

    const frame = await screen.findByRole('group', { name: 'Graph' });
    const rust = await within(frame).findByRole('group', { name: 'rust' });
    expect(zoomShown()).toBe('50%');
    expect(viewOf(rust)).toBe(`translate(${graph.width * xTimes} 0) scale(0.5)`);
    expect(frame.style.height).toBe(`${graph.height / 2}px`);
  },
);

test('the toolbar zooms the graph by steps of 1.25, to 100% about the frame centre and back to fitted, and a relayout refits', async () => {
  const user = userEvent.setup();
  const graph = await layoutDiff(review.diff);
  renderInFrame(pageWith(review), { width: graph.width / 2, windowHeight: 10_000 });
  const rust = await screen.findByRole('group', { name: 'rust' });
  const press = (name: string) => user.click(screen.getByRole('button', { name }));

  await press('Zoom in');
  expect(zoomShown()).toBe('63%');
  await press('Zoom out');
  expect(zoomShown()).toBe('50%');
  await press('100%');
  expect(zoomShown()).toBe('100%');
  expect(viewOf(rust)).toBe(`translate(${-graph.width / 4} ${-graph.height / 4}) scale(1)`);
  await press('Fit');
  expect(zoomShown()).toBe('50%');
  expect(viewOf(rust)).toBe('translate(0 0) scale(0.5)');

  await press('Zoom in');
  await showEverything(user);
  await waitFor(() => expect(zoomShown()).toBe('50%'));
});

test('dragging from a node pans the graph and selects nothing, even back near where it began, while a press that barely moves still selects it', async () => {
  const user = userEvent.setup();
  const graph = await layoutDiff(review.diff);
  renderInFrame(pageWith(review), { width: graph.width / 2, windowHeight: 10_000 });
  const rust = await screen.findByRole('group', { name: 'rust' });
  await user.click(screen.getByRole('button', { name: '100%' }));
  const domain = within(rust).getByRole('button', { name: 'domain: unchanged' });
  const drag = (...moves: ReadonlyArray<{ readonly clientX: number; readonly clientY: number }>) =>
    user.pointer([
      { keys: '[MouseLeft>]', target: domain, coords: { clientX: 100, clientY: 100 } },
      ...moves.map(coords => ({ coords })),
      { keys: '[/MouseLeft]' },
    ]);
  const pannedBy = (x: number, y: number) =>
    `translate(${x - graph.width / 4} ${y - graph.height / 4}) scale(1)`;

  await drag({ clientX: 140, clientY: 130 });
  expect(viewOf(rust)).toBe(pannedBy(40, 30));
  await drag({ clientX: 140, clientY: 130 }, { clientX: 102, clientY: 101 });
  expect(viewOf(rust)).toBe(pannedBy(42, 31));
  expect(screen.queryByRole('complementary', { name: 'Inspector' })).toBeNull();

  await drag({ clientX: 103, clientY: 100 });
  expect(viewOf(rust)).toBe(pannedBy(42, 31));
  expect(noteShown()).toBe('No note');

  await drag({ clientX: 140, clientY: 130 });
  screen.getByRole('button', { name: 'Zoom in' }).focus();
  await user.keyboard('{Enter}');
  expect(zoomShown()).toBe('125%');
  const panned = viewOf(rust);

  for (const button of ['MouseRight', 'MouseMiddle']) {
    await user.pointer([
      { keys: `[${button}>]`, target: domain, coords: { clientX: 100, clientY: 100 } },
      { coords: { clientX: 140, clientY: 130 } },
      { keys: `[/${button}]` },
    ]);
    expect(viewOf(rust)).toBe(panned);
  }

  fireEvent.pointerDown(domain, { button: 0, clientX: 100, clientY: 100 });
  fireEvent.pointerCancel(window);
  fireEvent.pointerMove(window, { clientX: 140, clientY: 130 });
  expect(viewOf(rust)).toBe(panned);
});

test('the wheel pans the graph, scrolling the page instead once the graph can move no further that way, and with Ctrl or ⌘ zooms it at the pointer', async () => {
  const graph = await layoutDiff(review.diff);
  renderInFrame(pageWith(review), { width: graph.width / 2, windowHeight: 10_000 });
  const rust = await screen.findByRole('group', { name: 'rust' });
  const frame = screen.getByRole('group', { name: 'Graph' });
  vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue(
    DOMRect.fromRect({ x: 10, y: 20, width: graph.width / 2, height: graph.height / 2 }),
  );

  expect(fireEvent.wheel(frame, { ctrlKey: true, deltaY: 100 })).toBe(false);
  expect(zoomShown()).toBe('50%');
  expect(fireEvent.wheel(frame, { ctrlKey: true, deltaY: -100, clientX: 10, clientY: 20 })).toBe(
    false,
  );
  expect(zoomShown()).toBe('100%');
  expect(viewOf(rust)).toBe('translate(0 0) scale(1)');
  expect(fireEvent.wheel(frame, { deltaX: -30, deltaY: -20 })).toBe(true);
  expect(fireEvent.wheel(frame, { deltaX: -30, deltaY: 20 })).toBe(false);
  expect(viewOf(rust)).toBe('translate(0 -20) scale(1)');
  expect(fireEvent.wheel(frame, { deltaX: 30, deltaY: -20 })).toBe(false);
  expect(viewOf(rust)).toBe('translate(-30 0) scale(1)');
  expect(fireEvent.wheel(frame, { deltaX: 30, deltaY: -20 })).toBe(false);
  expect(viewOf(rust)).toBe('translate(-60 0) scale(1)');
  expect(fireEvent.wheel(frame, { metaKey: true, deltaY: 50 })).toBe(false);
  expect(zoomShown()).toBe('71%');
});

test('with the frame focused, + = - step the zoom, 1 goes to 100%, 0 fits, and the arrows pan by 40px without scrolling the page', async () => {
  const user = userEvent.setup();
  const graph = await layoutDiff(review.diff);
  renderInFrame(pageWith(review), { width: graph.width / 2, windowHeight: 10_000 });
  const rust = await screen.findByRole('group', { name: 'rust' });
  const frame = screen.getByRole('group', { name: 'Graph' });
  const at100 = (x: number, y: number) =>
    `translate(${x - graph.width / 4} ${y - graph.height / 4}) scale(1)`;
  frame.focus();

  await user.keyboard('+');
  expect(zoomShown()).toBe('63%');
  await user.keyboard('=');
  expect(zoomShown()).toBe('78%');
  await user.keyboard('-');
  expect(zoomShown()).toBe('63%');
  await user.keyboard('1');
  expect(viewOf(rust)).toBe(at100(0, 0));
  await user.keyboard('{ArrowRight}');
  expect(viewOf(rust)).toBe(at100(-40, 0));
  await user.keyboard('{ArrowDown}');
  expect(viewOf(rust)).toBe(at100(-40, -40));
  await user.keyboard('{ArrowLeft}{ArrowLeft}');
  expect(viewOf(rust)).toBe(at100(40, -40));
  await user.keyboard('{ArrowUp}{ArrowUp}');
  expect(viewOf(rust)).toBe(at100(40, 40));
  expect(fireEvent.keyDown(frame, { key: 'ArrowUp' })).toBe(false);
  expect(fireEvent.keyDown(frame, { key: 'Tab' })).toBe(true);
  expect(fireEvent.keyDown(frame, { key: '=', ctrlKey: true })).toBe(true);
  expect(fireEvent.keyDown(frame, { key: '-', metaKey: true })).toBe(true);
  expect(fireEvent.keyDown(frame, { key: 'ArrowLeft', altKey: true })).toBe(true);
  expect(viewOf(rust)).toBe(at100(40, 80));
  await user.keyboard('0');
  expect(viewOf(rust)).toBe('translate(0 0) scale(0.5)');
});

test("resizing the frame keeps the zoom and the graph point at the frame's centre", async () => {
  const user = userEvent.setup();
  const graph = await layoutDiff(review.diff);
  const { resize } = renderInFrame(pageWith(review), {
    width: graph.width / 2,
    windowHeight: 10_000,
  });
  const rust = await screen.findByRole('group', { name: 'rust' });
  await user.click(screen.getByRole('button', { name: '100%' }));

  resize((graph.width * 3) / 4);
  expect(zoomShown()).toBe('100%');
  expect(viewOf(rust)).toBe(`translate(${-graph.width / 8} ${-graph.height / 8}) scale(1)`);
});

const onScreen = (
  element: Element | null,
  point = { x: 0, y: 0 },
): { readonly x: number; readonly y: number } => {
  const transform = element?.getAttribute('transform');
  if (!element || !transform) return point;
  const [, x = '0', y = '0'] = /translate\(([^ ]+) ([^)]+)\)/.exec(transform) ?? [];
  const [, scale = '1'] = /scale\(([^)]+)\)/.exec(transform) ?? [];
  return onScreen(element.parentElement, {
    x: Number(x) + point.x * Number(scale),
    y: Number(y) + point.y * Number(scale),
  });
};

test("toggling a box keeps the zoom and the box's corner where it was on screen, and a checkbox change then refits", async () => {
  const user = userEvent.setup();
  renderInFrame(
    pageWith({
      range: 'abc123..def456',
      diff: {
        nodes: [
          { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
          webModule('app'),
          webModule('utils', 'modified'),
          webFile('app', 'main.ts'),
          webFile('utils', 'x.ts', 'modified'),
          webFile('utils', 'y.ts'),
        ],
        edges: [webImport('app/main.ts', 'utils/x.ts', 'added')],
      },
    }),
    { width: 200, windowHeight: 10_000 },
  );
  const web = await screen.findByRole('group', { name: 'web' });
  const press = (name: string) => user.click(screen.getByRole('button', { name }));
  await press('100%');
  fireEvent.wheel(screen.getByRole('group', { name: 'Graph' }), {
    ctrlKey: true,
    deltaY: -100,
    clientX: 100,
    clientY: 50,
  });
  expect(zoomShown()).toBe('200%');
  const before = onScreen(within(web).getByRole('button', { name: 'Expand utils' }));

  await press('Expand utils');

  await within(web).findByRole('group', { name: 'utils' });
  const collapse = within(web).getByRole('button', { name: 'Collapse utils' });
  expect(zoomShown()).toBe('200%');
  expect(onScreen(collapse).x).toBeCloseTo(before.x);
  expect(onScreen(collapse).y).toBeCloseTo(before.y);

  const refitsFrom = async (zoom: string) => {
    await waitFor(() => expect(zoomShown()).not.toBe(zoom));
    const refitted = viewOf(web);
    await press('Fit');
    expect(viewOf(web)).toBe(refitted);
  };
  await user.click(screen.getByRole('checkbox', { name: 'All edges' }));
  await refitsFrom('200%');

  await press('100%');
  await press('Zoom in');
  await press('Collapse utils');
  await waitFor(() => expect(within(web).queryByRole('group', { name: 'utils' })).toBeNull());
  expect(zoomShown()).toBe('125%');
  await showEverything(user);
  await refitsFrom('125%');
});

test('going to a hidden file from the summary opens its module and lands it centred in the frame at 100%, focused, with the frame scrolled into view', async () => {
  const user = userEvent.setup();
  renderInFrame(
    pageWith({
      range: 'abc123..def456',
      diff: {
        nodes: [
          { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
          webModule('app'),
          webModule('utils', 'modified'),
          webFile('app', 'main.ts'),
          webFile('utils', 'x.ts', 'modified'),
          webFile('utils', 'y.ts'),
          webFile('utils', 'z.ts'),
        ],
        edges: [webImport('app/main.ts', 'utils/x.ts', 'added')],
      },
    }),
    {
      width: 120,
      windowHeight: 108,
      notes: {
        version: 1,
        tests: '',
        summary: [{ text: 'Check y.ts', target: 'web/file/utils/y.ts' }],
        notes: {},
      },
    },
  );
  await screen.findByRole('group', { name: 'web' });

  await user.click(screen.getByRole('button', { name: 'Check y.ts' }));

  const y = await screen.findByRole('button', { name: 'y.ts: unchanged' });
  await waitFor(() => expect(document.activeElement).toBe(y));
  const frame = screen.getByRole('group', { name: 'Graph' });
  const box = y.querySelector('rect');
  const centre = onScreen(y, {
    x: Number(box?.getAttribute('width')) / 2,
    y: Number(box?.getAttribute('height')) / 2,
  });
  expect(zoomShown()).toBe('100%');
  expect(centre.x).toBeCloseTo(60);
  expect(centre.y).toBeCloseTo(parseFloat(frame.style.height) / 2);
  expect(scrolledIntoView.mock.contexts).toContain(frame);
});

test("a PR's page is headed by the PR's number and title, as a link to it", async () => {
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        pullRequest: {
          number: 7,
          title: 'Add the cli crate',
          url: 'https://github.com/acme/shop/pull/7',
        },
      })}
    />,
  );

  expect(
    within(screen.getByRole('heading', { level: 1 })).getByRole('link', {
      name: '#7 Add the cli crate',
    }),
  ).toHaveProperty('href', 'https://github.com/acme/shop/pull/7');
  await screen.findByRole('group', { name: 'rust' });
});

test('the Review nav links Structure, Metrics and Tests, and marks Structure the current page', async () => {
  render(<ReviewPage review={pageWith(review)} />);

  const links = within(screen.getByRole('navigation', { name: 'Review' })).getAllByRole('link');
  expect(links.map(link => link.textContent)).toEqual(['Structure', 'Metrics', 'Tests']);
  expect(links[0]?.getAttribute('href')).toBe('#structure');
  expect(links[0]?.getAttribute('aria-current')).toBe('page');
  await screen.findByRole('group', { name: 'rust' });
});

const atHash = (hash: string) => {
  history.replaceState(null, '', hash);
  onTestFinished(() => history.replaceState(null, '', location.pathname));
};

const currentTab = () =>
  within(screen.getByRole('navigation', { name: 'Review' })).getByRole('link', { current: 'page' })
    .textContent;

test.for([
  { hash: '#metrics', tab: 'Metrics' },
  { hash: '#elsewhere', tab: 'Structure' },
])('at $hash the page opens on $tab', ({ hash, tab }) => {
  atHash(hash);
  render(<ReviewPage review={pageWith(review)} />);

  expect(currentTab()).toBe(tab);
  expect(screen.queryByRole('checkbox', { name: 'Changed + 1 hop' }) !== null).toBe(
    tab === 'Structure',
  );
});

test("the Tests tab's link counts the review's changed tests, a moved pair once, and carries no count with none changed", async () => {
  atHash('');
  const user = userEvent.setup();
  const { rerender } = render(
    <ReviewPage
      review={pageWith({
        ...review,
        tests: [
          {
            path: 'crates/application/src/lib.rs',
            stack: 'rust',
            statements: [
              { kind: 'test', name: 'reads the notes', change: 'edited' },
              {
                kind: 'test',
                name: 'exports a CSV',
                change: 'removed',
                movedTo: 'crates/domain/src/lib.rs',
              },
            ],
          },
          {
            path: 'crates/domain/src/lib.rs',
            stack: 'rust',
            statements: [
              {
                kind: 'test',
                name: 'exports a CSV',
                change: 'added',
                movedFrom: 'crates/application/src/lib.rs',
              },
            ],
          },
        ],
      })}
    />,
  );

  expect(
    within(screen.getByRole('navigation', { name: 'Review' }))
      .getAllByRole('link')
      .map(link => link.textContent),
  ).toEqual(['Structure', 'Metrics', 'Tests 2']);
  await user.click(screen.getByRole('link', { name: 'Tests 2' }));
  await waitFor(() => expect(currentTab()).toBe('Tests 2'));
  expect(screen.queryByRole('group', { name: 'rust' })).toBeNull();
  rerender(<ReviewPage review={pageWith(review)} />);
  expect(screen.getByRole('link', { name: 'Tests' })).not.toBeNull();
});

const testsShown = () =>
  within(screen.getByRole('region', { name: 'Test changes' }))
    .queryAllByRole('region')
    .map(file => file.getAttribute('aria-label'));

test("the Tests tab heads the test changes with what the notes say they pin, and lists each changed test file with its stack's label, marking a new one and what a renamed one was; with no notes and no test changed, it says so", () => {
  atHash('#tests');
  const added = [{ kind: 'test' as const, name: 'reads the notes', change: 'added' as const }];
  const { rerender } = render(
    <ReviewPage
      review={pageWith({
        ...review,
        diff: {
          ...review.diff,
          nodes: [
            ...review.diff.nodes,
            { id: 'web', kind: 'stack', label: 'Web app', path: '', state: 'unchanged' },
          ],
        },
        tests: [
          {
            path: 'crates/application/tests/export.rs',
            stack: 'rust',
            new: true,
            statements: added,
          },
          {
            path: 'web/src/notes.test.ts',
            stack: 'web',
            renamedFrom: 'web/src/note.test.ts',
            statements: added,
          },
          { path: 'tools/review/x.test.ts', stack: 'tools/review', statements: added },
        ],
      })}
      notes={{ version: 1, summary: [], tests: 'The export is pinned.', notes: {} }}
    />,
  );

  expect(
    within(screen.getByRole('region', { name: 'What they pin' })).getByText(
      'The export is pinned.',
    ),
  ).not.toBeNull();
  expect(testsShown()).toEqual([
    'crates/application/tests/export.rs',
    'web/src/notes.test.ts',
    'tools/review/x.test.ts',
  ]);
  const exported = screen.getByRole('region', { name: 'crates/application/tests/export.rs' });
  expect(within(exported).getByText('rust')).not.toBeNull();
  expect(within(exported).getByText('new file')).not.toBeNull();
  const notesTest = screen.getByRole('region', { name: 'web/src/notes.test.ts' });
  expect(within(notesTest).getByText('Web app')).not.toBeNull();
  expect(within(notesTest).getByText('renamed from web/src/note.test.ts')).not.toBeNull();
  expect(within(notesTest).queryByText('new file')).toBeNull();
  const undrawn = screen.getByRole('region', { name: 'tools/review/x.test.ts' });
  expect(within(undrawn).getByText('tools/review')).not.toBeNull();

  rerender(<ReviewPage review={pageWith(review)} />);
  expect(screen.queryByRole('region', { name: 'What they pin' })).toBeNull();
  expect(testsShown()).toEqual([]);
  expect(
    within(screen.getByRole('region', { name: 'Test changes' })).getByText('No test changed.'),
  ).not.toBeNull();
});

test('the Tests tab shows all the test changes by default, or, while a node is picked on Structure, those alongside it, saying so when none changed there; with the pick cleared it shows them all', async () => {
  atHash('');
  const user = userEvent.setup();
  const added = (name: string) => ({ kind: 'test' as const, name, change: 'added' as const });
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        tests: [
          {
            path: 'crates/application/src/lib.rs',
            stack: 'rust',
            statements: [added('reads the notes')],
          },
          {
            path: 'crates/application/tests/export.rs',
            stack: 'rust',
            statements: [added('exports a CSV'), added('names the columns')],
          },
          {
            path: 'crates/cli-adapter/src/main.rs',
            stack: 'rust',
            statements: [added('parses the args')],
          },
        ],
      })}
    />,
  );
  const shownBy = (name: string) =>
    within(screen.getByRole('group', { name: 'Tests shown' })).getByRole('button', { name });
  const goTo = (tab: string) =>
    user.click(
      within(screen.getByRole('navigation', { name: 'Review' })).getByRole('link', {
        name: new RegExp(`^${tab}`),
      }),
    );

  await user.click(await screen.findByRole('button', { name: 'application: modified' }));
  await goTo('Tests');
  expect(shownBy('All 4').getAttribute('aria-pressed')).toBe('true');
  expect(shownBy('For application 3').getAttribute('aria-pressed')).toBe('false');
  expect(testsShown()).toHaveLength(3);
  await user.click(shownBy('For application 3'));
  expect(shownBy('For application 3').getAttribute('aria-pressed')).toBe('true');
  expect(shownBy('All 4').getAttribute('aria-pressed')).toBe('false');
  expect(testsShown()).toEqual([
    'crates/application/src/lib.rs',
    'crates/application/tests/export.rs',
  ]);

  await goTo('Structure');
  await user.click(await screen.findByRole('button', { name: 'domain: unchanged' }));
  await goTo('Tests');
  await user.click(shownBy('For domain 0'));
  expect(testsShown()).toEqual([]);
  expect(
    within(screen.getByRole('region', { name: 'Test changes' })).getByText('No test changed here.'),
  ).not.toBeNull();
  await user.click(shownBy('All 4'));
  expect(testsShown()).toHaveLength(3);

  await goTo('Structure');
  await user.click(within(inspector()).getByRole('button', { name: 'Close inspector' }));
  await goTo('Tests');
  expect(
    within(screen.getByRole('group', { name: 'Tests shown' }))
      .getAllByRole('button')
      .map(button => `${button.textContent} ${button.getAttribute('aria-pressed')}`),
  ).toEqual(['All 4 true']);
});

test('the Tests tab counts the shown tests by change, a moved pair once, as moved, even with only one of its files shown', async () => {
  atHash('');
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        tests: [
          {
            path: 'crates/application/src/lib.rs',
            stack: 'rust',
            statements: [
              { kind: 'test', name: 'reads the notes', change: 'edited' },
              { kind: 'test', name: 'quotes commas', change: 'added' },
              {
                kind: 'test',
                name: 'exports a CSV',
                change: 'removed',
                movedTo: 'crates/domain/src/lib.rs',
              },
            ],
          },
          {
            path: 'crates/domain/src/lib.rs',
            stack: 'rust',
            statements: [
              { kind: 'test', name: 'drops the totals', change: 'removed' },
              {
                kind: 'test',
                name: 'exports a CSV',
                change: 'added',
                movedFrom: 'crates/application/src/lib.rs',
              },
            ],
          },
        ],
      })}
    />,
  );
  const counts = () =>
    within(screen.getByRole('list', { name: 'Changed tests' }))
      .getAllByRole('listitem')
      .map(count => `${count.textContent} ${count.getAttribute('aria-label')}`);

  await user.click(await screen.findByRole('button', { name: 'domain: unchanged' }));
  await user.click(screen.getByRole('link', { name: 'Tests 4' }));
  expect(counts()).toEqual(['+1 1 added', '✎1 1 edited', '−1 1 removed', '↷1 1 moved']);
  await user.click(screen.getByRole('button', { name: 'For domain 2' }));
  expect(counts()).toEqual(['+0 0 added', '✎0 0 edited', '−1 1 removed', '↷1 1 moved']);
});

test("the Tests tab lists the added and modified nodes, not stacks, with the changed tests alongside each, those with none first, marked as needing a look; a node's name goes to it on Structure, focused, its inspector open", async () => {
  atHash('#tests');
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        diff: {
          ...review.diff,
          nodes: [
            { id: 'rust', kind: 'stack', label: 'rust', path: '', state: 'modified' },
            crate('domain', 'unchanged'),
            crate('application', 'modified'),
            crate('cli-adapter', 'added'),
            crate('legacy', 'removed'),
            crate('billing', 'modified'),
          ],
        },
        tests: [
          {
            path: 'crates/application/tests/export.rs',
            stack: 'rust',
            statements: [
              { kind: 'test', name: 'exports a CSV', change: 'added' },
              { kind: 'test', name: 'names the columns', change: 'edited' },
              { kind: 'test', name: 'quotes commas', change: 'unchanged' },
            ],
          },
          {
            path: 'crates/legacy/tests/export.rs',
            stack: 'rust',
            statements: [{ kind: 'test', name: 'exports a CSV', change: 'removed' }],
          },
        ],
      })}
    />,
  );

  expect(
    within(screen.getByRole('region', { name: 'Changed nodes' }))
      .getAllByRole('listitem')
      .map(node =>
        [
          node.getAttribute('aria-label'),
          ...within(node)
            .queryAllByRole('img')
            .map(mark => mark.getAttribute('aria-label')),
        ].join(', '),
      ),
  ).toEqual([
    'cli-adapter: added, tests alongside: none, needs a look',
    'billing: modified, tests alongside: none, needs a look',
    'application: modified, tests alongside: 2',
  ]);

  await user.click(
    within(screen.getByRole('region', { name: 'Changed nodes' })).getByRole('button', {
      name: 'billing',
    }),
  );
  await waitFor(() => expect(currentTab()).toBe('Structure'));
  const billing = await screen.findByRole('button', { name: 'billing: modified' });
  await waitFor(() => expect(document.activeElement).toBe(billing));
  expect(within(inspector()).getByRole('heading', { name: 'billing' })).not.toBeNull();
});

test("a Metrics row's node name goes to it on Structure, focused, its inspector open", async () => {
  atHash('#metrics');
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        metrics: { 'rust/crate/application': { base: measured(), head: measured() } },
      })}
    />,
  );

  await user.click(
    within(screen.getByRole('region', { name: 'Metrics per node' })).getByRole('button', {
      name: 'application',
    }),
  );
  await waitFor(() => expect(currentTab()).toBe('Structure'));
  const application = await screen.findByRole('button', { name: 'application: modified' });
  await waitFor(() => expect(document.activeElement).toBe(application));
  expect(within(inspector()).getByRole('heading', { name: 'application' })).not.toBeNull();
});

test('picking a tab sets the hash and shows it, and back and forward move between the tabs', async () => {
  atHash('');
  const user = userEvent.setup();
  render(<ReviewPage review={pageWith(review)} />);
  await screen.findByRole('group', { name: 'rust' });

  await user.click(screen.getByRole('link', { name: 'Metrics' }));
  await waitFor(() => expect(currentTab()).toBe('Metrics'));
  expect(location.hash).toBe('#metrics');
  expect(screen.queryByRole('group', { name: 'rust' })).toBeNull();

  history.back();
  await waitFor(() => expect(currentTab()).toBe('Structure'));
  history.forward();
  await waitFor(() => expect(currentTab()).toBe('Metrics'));
  location.hash = '#tests';
  await waitFor(() => expect(currentTab()).toBe('Tests'));
});

test('a reader skipped for want of its tool is named at the top of the findings rail, collapsed or open, with the stacks it did not read', async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        skipped: [{ reader: 'rust', tool: 'cargo', stacks: ['rust', 'rust~2'] }],
      })}
    />,
  );

  const line = 'rust, rust~2 not read: cargo not found on PATH';
  const collapsed = await screen.findByRole('navigation', { name: 'Findings' });
  expect(within(within(collapsed).getByRole('alert')).getByText(line)).toBeDefined();
  await user.click(within(collapsed).getByRole('button', { name: 'Show 0 findings' }));
  const open = screen.getByRole('complementary', { name: 'Findings' });
  expect(within(open).getByRole('alert').textContent).toBe(line);
  expect(screen.getAllByRole('alert')).toHaveLength(1);
});

test('the findings rail hands the keyboard focus to its other toggle as it opens and hides, and takes none as the page opens or while a node is picked with the rail open', async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={pageWith(review)} />);
  const show = await screen.findByRole('button', { name: 'Show 0 findings' });
  expect(document.activeElement).toBe(document.body);

  show.focus();
  await user.keyboard('{Enter}');
  const hide = screen.getByRole('button', { name: 'Hide findings' });
  expect(document.activeElement).toBe(hide);

  const domain = screen.getByRole('button', { name: 'domain: unchanged' });
  await user.click(domain);
  expect(document.activeElement).toBe(domain);

  hide.focus();
  await user.keyboard('{Enter}');
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Show 0 findings' }));
});

test.for([
  {
    range: '646f56cfd31dbe78c3b93e793c174efe85d8f666..fe2b80f6d56a89db7649e4e59a7b73790e5f8202',
    heading: '646f56c..fe2b80f',
    graph: 'Structure 646f56c..fe2b80f',
  },
  { range: 'main..my-branch', heading: 'main..my-branch', graph: 'Structure main..my-branch' },
  { range: 'HEAD..worktree', heading: 'Uncommitted work', graph: 'Structure HEAD..worktree' },
])(
  'a page with no PR is headed by $range, by short SHAs, and so is its graph',
  async ({ range, heading, graph }) => {
    render(<ReviewPage review={pageWith({ ...review, range })} />);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(heading);
    await screen.findByRole('group', { name: 'rust' });
    expect(screen.getByTitle(graph).tagName).toBe('title');
  },
);

test("a short SHA in the header's range shows its full SHA on hover", async () => {
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        pullRequest: {
          number: 7,
          title: 'Add the cli crate',
          url: 'https://github.com/acme/shop/pull/7',
        },
        range: '646f56cfd31dbe78c3b93e793c174efe85d8f666..fe2b80f6d56a89db7649e4e59a7b73790e5f8202',
      })}
    />,
  );

  expect(screen.getByTitle('646f56cfd31dbe78c3b93e793c174efe85d8f666').textContent).toBe('646f56c');
  expect(screen.getByTitle('fe2b80f6d56a89db7649e4e59a7b73790e5f8202').textContent).toBe('fe2b80f');
  await screen.findByRole('group', { name: 'rust' });
});

test('clicking a crate or a dependency, or pressing Enter or Space on it, shows its note, a crate without one says so, and a flagged one is named with its flag', async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        ...review,
      })}
      notes={{
        version: 1,
        tests: '',
        summary: [],
        notes: {
          'rust/crate/application': { text: 'Adds the export use case.' },
          'rust/crate/cli-adapter': { text: 'A second way in.', flag: 'new entry point' },
          'rust/crate/cli-adapter -> rust/crate/application': {
            text: 'The CLI drives the use case.',
            flag: 'new dependency direction',
          },
        },
      }}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'application: modified' }));
  expect(noteShown()).toBe('Adds the export use case.');

  await user.click(
    screen.getByRole('button', {
      name: 'cli-adapter → application: added, flagged: new dependency direction',
    }),
  );
  expect(noteShown()).toBe('The CLI drives the use case.');

  await user.click(
    screen.getByRole('button', { name: 'cli-adapter: added, flagged: new entry point' }),
  );
  expect(noteShown()).toBe('A second way in.');

  await user.click(screen.getByRole('button', { name: 'domain: unchanged' }));
  expect(noteShown()).toBe('No note');

  screen.getByRole('button', { name: 'application: modified' }).focus();
  await user.keyboard('a');
  expect(noteShown()).toBe('No note');
  await user.keyboard('{Enter}');
  expect(noteShown()).toBe('Adds the export use case.');

  screen
    .getByRole('button', {
      name: 'cli-adapter → application: added, flagged: new dependency direction',
    })
    .focus();
  await user.keyboard(' ');
  expect(noteShown()).toBe('The CLI drives the use case.');
});

test("a flag's badge says on hover what it is flagged for, and clicking it opens the note of what it marks", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith(review)}
      notes={{
        version: 1,
        tests: '',
        summary: [],
        notes: {
          'rust/crate/cli-adapter': { text: 'A second way in.', flag: 'new entry point' },
          'rust/crate/cli-adapter -> rust/crate/application': {
            text: 'The CLI drives the use case.',
            flag: 'new dependency direction',
          },
        },
      }}
    />,
  );

  await screen.findByRole('group', { name: 'rust' });
  expect(screen.getByRole('img', { name: 'Flagged: new entry point' })).toBeTruthy();
  expect(screen.getByRole('img', { name: 'Flagged: new dependency direction' })).toBeTruthy();
  expect(
    screen.getByRole('img', { name: 'Flagged: new entry point' }).querySelector('title')
      ?.textContent,
  ).toBe('Flagged: new entry point');

  await user.click(screen.getByRole('img', { name: 'Flagged: new dependency direction' }));
  expect(noteShown()).toBe('The CLI drives the use case.');
  expect(reasonsShown()).toEqual(['Flagged: new dependency direction']);
  await user.click(screen.getByRole('img', { name: 'Flagged: new entry point' }));
  expect(noteShown()).toBe('A second way in.');
  expect(reasonsShown()).toEqual(['Flagged: new entry point']);

  await user.click(screen.getByRole('button', { name: 'domain: unchanged' }));
  expect(reasonsShown()).toEqual([]);
});

test('the summary lists its items, not the flagged notes, and an item with a target takes focus to it and shows its note; with no items there is no summary', async () => {
  const user = userEvent.setup();
  const { rerender } = render(
    <ReviewPage
      review={pageWith({
        ...review,
      })}
      notes={{
        version: 1,
        tests: '',
        summary: [
          { text: 'The CLI is a new adapter.', target: 'rust/crate/cli-adapter' },
          { text: 'Domain is untouched.' },
        ],
        notes: {
          'rust/crate/cli-adapter': { text: 'A second way in.' },
          'rust/crate/cli-adapter -> rust/crate/application': {
            text: 'The CLI drives the use case.',
            flag: 'new dependency direction',
          },
          'rust/crate/legacy': {
            text: 'Domain still reaches it.',
            flag: 'removed but depended on',
          },
        },
      }}
    />,
  );

  const summary = await screen.findByRole('region', { name: 'Summary' });
  const items = within(summary).getAllByRole('listitem');
  expect(items.map(item => item.textContent)).toEqual([
    'The CLI is a new adapter.',
    'Domain is untouched.',
  ]);
  expect(
    within(summary)
      .getAllByRole('button')
      .map(button => button.textContent),
  ).toEqual(['The CLI is a new adapter.']);

  const focus = vi.spyOn(SVGElement.prototype, 'focus');
  onTestFinished(() => focus.mockRestore());
  await user.click(within(summary).getByRole('button', { name: 'The CLI is a new adapter.' }));
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'cli-adapter: added' }));
  expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  expect(noteShown()).toBe('A second way in.');

  rerender(
    <ReviewPage
      review={pageWith(review)}
      notes={{ version: 1, tests: '', summary: [], notes: {} }}
    />,
  );
  expect(screen.queryByRole('region', { name: 'Summary' })).toBeNull();
});

test("the findings rail starts collapsed to their total and how many need a look or are for information: notes' flags need a look, metric findings keep their level, and each not-drawn line is for information; opened, it shows the groups holding findings, and hides again", async () => {
  const user = userEvent.setup();
  const { rerender } = render(
    <ReviewPage
      review={pageWith({
        ...review,
        metricFindings: [
          { node: 'rust/crate/domain', metric: 'lines', level: 'info', head: 900, threshold: 800 },
          {
            node: 'rust/crate/application',
            metric: 'cyclomatic',
            level: 'look',
            base: 4,
            head: 14,
            threshold: 10,
          },
        ],
        dangling: [
          { from: 'rust/crate/cli-adapter', path: '/api/a' },
          { from: 'rust/crate/cli-adapter', path: '/api/b' },
        ],
        undrawn: [{ path: 'README.md', patch: '' }],
      })}
      notes={{
        version: 1,
        tests: '',
        summary: [],
        notes: {
          'rust/crate/cli-adapter': { text: 'A second way in.', flag: 'new entry point' },
          'rust/crate/domain': { text: 'Untouched.' },
          'rust/crate/cli-adapter -> rust/crate/application': {
            text: 'The CLI drives the use case.',
            flag: 'new dependency direction',
          },
        },
      }}
    />,
  );

  await screen.findByRole('navigation', { name: 'Findings' });
  const rail = () => screen.getByRole('navigation', { name: 'Findings' });
  expect(within(rail()).getByRole('button', { name: 'Show 6 findings' })).toBeDefined();
  const countBy = (level: string) =>
    within(rail()).getByRole('img', { name: level }).parentElement?.textContent;
  expect(countBy('needs a look')).toBe('3');
  expect(countBy('for information')).toBe('3');

  const groupsShown = async () => {
    await user.click(screen.getByRole('button', { name: /^Show \d+ findings?$/ }));
    const open = screen.getByRole('complementary', { name: 'Findings' });
    const groups = within(open)
      .getAllByRole('heading', { level: 3 })
      .map(heading => heading.textContent);
    await user.click(within(open).getByRole('button', { name: 'Hide findings' }));
    return groups;
  };
  expect(await groupsShown()).toEqual(['Flagged in notes', 'Metrics', 'Not drawn']);
  expect(screen.queryByRole('complementary', { name: 'Findings' })).toBeNull();

  await user.click(screen.getByRole('button', { name: 'Show 6 findings' }));
  const flagged = within(screen.getByRole('region', { name: 'Flagged in notes' }));
  expect(
    flagged.getByRole('button', { name: 'cli-adapter: new entry point: A second way in.' }),
  ).toBeDefined();
  expect(
    flagged.getByRole('button', {
      name: 'cli-adapter → application: new dependency direction: The CLI drives the use case.',
    }),
  ).toBeDefined();
  const notDrawn = within(screen.getByRole('region', { name: 'Not drawn' }));
  expect(notDrawn.getByText('2 calls with no route')).toBeDefined();
  expect(notDrawn.getByText('/api/a, /api/b')).toBeDefined();
  expect(notDrawn.getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual([
    'README.md: 1 changed file outside the graph',
  ]);

  const chips = within(screen.getByRole('group', { name: 'Show findings' }));
  const pressed = () =>
    chips
      .getAllByRole('button')
      .map(chip => `${chip.textContent} ${chip.getAttribute('aria-pressed')}`);
  expect(pressed()).toEqual([
    'All 6 true',
    'Notes 2 false',
    'Metrics 2 false',
    'Not drawn 2 false',
  ]);
  const headings = () =>
    within(screen.getByRole('complementary', { name: 'Findings' }))
      .getAllByRole('heading', { level: 3 })
      .map(heading => heading.textContent);
  await user.click(chips.getByRole('button', { name: 'Metrics 2' }));
  expect(pressed()).toEqual([
    'All 6 false',
    'Notes 2 false',
    'Metrics 2 true',
    'Not drawn 2 false',
  ]);
  expect(headings()).toEqual(['Metrics']);
  await user.click(chips.getByRole('button', { name: 'All 6' }));
  expect(headings()).toEqual(['Flagged in notes', 'Metrics', 'Not drawn']);
  await user.click(screen.getByRole('button', { name: 'Hide findings' }));

  rerender(
    <ReviewPage
      review={pageWith({
        ...review,
        metricFindings: [
          { node: 'rust/crate/domain', metric: 'lines', level: 'info', head: 900, threshold: 800 },
        ],
      })}
    />,
  );
  expect(within(rail()).getByRole('button', { name: 'Show 1 finding' })).toBeDefined();
  expect(countBy('needs a look')).toBe('0');
  expect(await groupsShown()).toEqual(['Metrics']);
});

test('the rail reads each metric finding as a sentence on its node: the move from base to head, or the head alone, and the threshold it is over; a hotspot names its churn and cyclomatic', async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        metricFindings: [
          {
            node: 'rust/crate/application',
            metric: 'cyclomatic',
            level: 'look',
            base: 4,
            head: 14,
            threshold: 10,
          },
          { node: 'rust/crate/domain', metric: 'lines', level: 'info', head: 900, threshold: 800 },
          {
            node: 'rust/crate/domain',
            metric: 'abc',
            level: 'look',
            base: 28.25,
            head: 31.5,
            threshold: 30,
          },
          {
            node: 'rust/crate/cli-adapter',
            metric: 'hotspot',
            level: 'info',
            base: { churn: 6, cyclomatic: 9 },
            head: { churn: 7, cyclomatic: 12 },
            threshold: { churn: 6, cyclomatic: 8 },
          },
        ],
      })}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'Show 4 findings' }));
  const metrics = within(screen.getByRole('region', { name: 'Metrics' }));
  expect(
    metrics.getByRole('button', { name: 'application: cyclomatic 4 → 14, over 10' }),
  ).toBeDefined();
  expect(metrics.getByRole('button', { name: 'domain: lines 900, over 800' })).toBeDefined();
  expect(
    metrics.getByRole('button', { name: 'domain: ABC size 28.3 → 31.5, over 30' }),
  ).toBeDefined();
  expect(
    metrics.getByRole('button', {
      name: 'cli-adapter: hotspot, churn 6 → 7 and cyclomatic 9 → 12, over 6 and 8',
    }),
  ).toBeDefined();
});

test("a note's or a metric finding in the rail goes to its node or edge as the summary's links do", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        metricFindings: [
          { node: 'rust/crate/domain', metric: 'lines', level: 'info', head: 900, threshold: 800 },
        ],
      })}
      notes={{
        version: 1,
        tests: '',
        summary: [],
        notes: {
          'rust/crate/cli-adapter -> rust/crate/application': {
            text: 'The CLI drives the use case.',
            flag: 'new dependency direction',
          },
        },
      }}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'Show 2 findings' }));
  await user.click(screen.getByRole('button', { name: /^cli-adapter → application: new/ }));
  expect(document.activeElement).toBe(
    screen.getByRole('button', {
      name: 'cli-adapter → application: added, flagged: new dependency direction',
    }),
  );
  expect(noteShown()).toBe('The CLI drives the use case.');

  await user.click(screen.getByRole('button', { name: 'domain: lines 900, over 800' }));
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'domain: unchanged' }));
});

const webModule = (label: string, state: Diffed = 'unchanged') => ({
  id: `web/module/${label}`,
  kind: 'module' as const,
  label,
  parent: 'web',
  path: `web/src/${label}`,
  state,
});

const webFile = (module: string, label: string, state: Diffed = 'unchanged') => ({
  id: `web/file/${module}/${label}`,
  kind: 'file' as const,
  label,
  parent: `web/module/${module}`,
  path: `web/src/${module}/${label}`,
  state,
});

const webImport = (from: string, to: string, state: GraphDiff['edges'][number]['state']) => ({
  from: `web/file/${from}`,
  to: `web/file/${to}`,
  state,
});

const buttonsIn = (element: HTMLElement) =>
  within(element)
    .getAllByRole('button')
    .map(drawn => drawn.getAttribute('aria-label'));

test("modules open collapsed, joined by their files' imports; a module's toggle expands it into its files and back; a note on a hidden import shows on the edge it merges into; a summary item on a hidden file or a rail finding on a hidden import expands what hides it and focuses it, without pulling focus back later", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        range: 'abc123..def456',
        diff: {
          nodes: [
            { id: 'rust', kind: 'stack', label: 'rust', path: '', state: 'unchanged' },
            crate('domain', 'unchanged'),
            crate('application', 'unchanged'),
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
            webModule('modules/AppInfo'),
            webModule('utils', 'modified'),
            webFile('modules/AppInfo', 'api/app-info.ts'),
            webFile('modules/AppInfo', 'AppInfo.tsx'),
            webFile('utils', 'x.ts', 'modified'),
            webFile('utils', 'y.ts'),
          ],
          edges: [
            dependency('application', 'domain', 'unchanged'),
            {
              from: 'web/file/modules/AppInfo/api/app-info.ts',
              to: 'web/file/utils/x.ts',
              state: 'added',
            },
            {
              from: 'web/file/modules/AppInfo/AppInfo.tsx',
              to: 'web/file/utils/x.ts',
              state: 'added',
            },
          ],
        },
      })}
      notes={{
        version: 1,
        tests: '',
        summary: [{ text: 'Check y.ts', target: 'web/file/utils/y.ts' }],
        notes: {
          'web/file/modules/AppInfo/api/app-info.ts -> web/file/utils/x.ts': {
            text: 'New helper.',
            flag: 'reaches into utils',
          },
          'web/file/utils/y.ts': { text: 'Untouched, but read it.' },
        },
      }}
    />,
  );

  await showEverything(user);
  const web = await screen.findByRole('group', { name: 'web' });
  expect(screen.queryByRole('region', { name: 'Unplaced notes' })).toBeNull();
  const collapsed = [
    'modules/AppInfo → utils: added, flagged: reaches into utils',
    'modules/AppInfo: unchanged',
    'Expand modules/AppInfo',
    'utils: modified',
    'Expand utils',
  ];
  expect(buttonsIn(web)).toEqual(collapsed);
  expect(buttonsIn(screen.getByRole('group', { name: 'rust' }))).toEqual([
    'application → domain: unchanged',
    'domain: unchanged',
    'application: unchanged',
  ]);
  await user.click(within(web).getByRole('button', { name: /^modules\/AppInfo → utils/ }));
  expect(noteShown()).toBe('New helper.');

  await user.click(within(web).getByRole('button', { name: 'Expand utils' }));

  const utils = await within(web).findByRole('group', { name: 'utils' });
  expect(buttonsIn(utils)).toEqual(['x.ts: modified', 'y.ts: unchanged']);
  expect(
    within(web).getByRole('button', {
      name: 'modules/AppInfo → x.ts: added, flagged: reaches into utils',
    }),
  ).toBeTruthy();
  const collapse = within(web).getByRole('button', { name: 'Collapse utils' });
  expect(collapse.getAttribute('aria-expanded')).toBe('true');

  await user.click(collapse);

  await waitFor(() => expect(buttonsIn(web)).toEqual(collapsed));
  expect(
    within(web).getByRole('button', { name: 'Expand utils' }).getAttribute('aria-expanded'),
  ).toBe('false');

  await user.click(screen.getByRole('button', { name: 'Check y.ts' }));

  const y = await within(web).findByRole('button', { name: 'y.ts: unchanged' });
  await waitFor(() => expect(document.activeElement).toBe(y));
  expect(noteShown()).toBe('Untouched, but read it.');

  await user.click(within(web).getByRole('button', { name: 'Expand modules/AppInfo' }));

  await within(web).findByRole('group', { name: 'modules/AppInfo' });
  expect(document.activeElement).not.toBe(y);

  await user.click(within(web).getByRole('button', { name: 'Collapse modules/AppInfo' }));
  await user.click(within(web).getByRole('button', { name: 'Collapse utils' }));
  await user.click(screen.getByRole('button', { name: /^Show \d+ findings?$/ }));
  await user.click(screen.getByRole('button', { name: /: reaches into utils: New helper\.$/ }));

  const reaching = await within(web).findByRole('button', {
    name: 'api/app-info.ts → x.ts: added, flagged: reaches into utils',
  });
  await waitFor(() => expect(document.activeElement).toBe(reaching));
  expect(noteShown()).toBe('New helper.');
});

test("with 'All edges' unticked, an unchanged import between two open modules is drawn module to module unless it has a note; ticking it draws every import; going to a merged import from the summary ticks it", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        range: 'abc123..def456',
        diff: {
          nodes: [
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
            webModule('orders'),
            webModule('billing'),
            webFile('orders', 'cart.ts'),
            webFile('orders', 'checkout.ts'),
            webFile('billing', 'invoice.ts'),
          ],
          edges: [
            webImport('orders/cart.ts', 'billing/invoice.ts', 'unchanged'),
            webImport('orders/checkout.ts', 'billing/invoice.ts', 'unchanged'),
          ],
        },
      })}
      notes={{
        version: 1,
        tests: '',
        summary: [
          {
            text: 'See checkout.',
            target: 'web/file/orders/checkout.ts -> web/file/billing/invoice.ts',
          },
        ],
        notes: {
          'web/file/orders/cart.ts -> web/file/billing/invoice.ts': { text: 'Totals.' },
        },
      }}
    />,
  );
  await showEverything(user);
  const web = await screen.findByRole('group', { name: 'web' });
  const all = screen.getByRole('checkbox', { name: 'All edges' });
  expect(all).toHaveProperty('checked', false);
  await user.click(within(web).getByRole('button', { name: 'Expand orders' }));
  await user.click(within(web).getByRole('button', { name: 'Expand billing' }));
  await within(web).findByRole('group', { name: 'billing' });

  const imports = () => buttonsIn(web).filter(name => name?.includes('→'));
  await waitFor(() =>
    expect(imports()).toEqual(['cart.ts → invoice.ts: unchanged', 'orders → billing: unchanged']),
  );

  await user.click(all);

  await waitFor(() =>
    expect(imports()).toEqual([
      'cart.ts → invoice.ts: unchanged',
      'checkout.ts → invoice.ts: unchanged',
    ]),
  );

  await user.click(all);
  await waitFor(() => expect(imports()).toContain('orders → billing: unchanged'));
  await user.click(screen.getByRole('button', { name: 'See checkout.' }));

  expect(all).toHaveProperty('checked', true);
  await waitFor(() =>
    expect(document.activeElement).toBe(
      within(web).getByRole('button', { name: 'checkout.ts → invoice.ts: unchanged' }),
    ),
  );
});

test("with 'Changed + 1 hop' ticked, going to a merged module edge or to a hidden import near a change keeps it ticked", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        range: 'abc123..def456',
        diff: {
          nodes: [
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
            webModule('orders', 'modified'),
            webModule('billing'),
            webFile('orders', 'cart.ts'),
            webFile('orders', 'checkout.ts'),
            webFile('billing', 'invoice.ts'),
          ],
          edges: [
            webImport('orders/cart.ts', 'billing/invoice.ts', 'added'),
            webImport('orders/checkout.ts', 'orders/cart.ts', 'added'),
            webImport('orders/checkout.ts', 'billing/invoice.ts', 'unchanged'),
          ],
        },
      })}
      notes={{
        version: 1,
        tests: '',
        summary: [
          { text: 'See the coupling.', target: 'web/module/orders -> web/module/billing' },
          {
            text: 'See checkout.',
            target: 'web/file/orders/checkout.ts -> web/file/billing/invoice.ts',
          },
        ],
        notes: {},
      }}
    />,
  );
  const web = await screen.findByRole('group', { name: 'web' });
  await user.click(within(web).getByRole('button', { name: 'Expand orders' }));
  await user.click(await within(web).findByRole('button', { name: 'Expand billing' }));
  await within(web).findByRole('group', { name: 'billing' });
  const hop = screen.getByRole('checkbox', { name: 'Changed + 1 hop' });

  await user.click(screen.getByRole('button', { name: 'See the coupling.' }));

  expect(hop).toHaveProperty('checked', true);

  await user.click(screen.getByRole('button', { name: 'See checkout.' }));

  expect(screen.getByRole('checkbox', { name: 'All edges' })).toHaveProperty('checked', true);
  expect(hop).toHaveProperty('checked', true);
});

test("web calls to API routes are drawn between the stacks, named by their paths, merged while their module is collapsed and split by file once it's expanded; a call with no route marks the node holding it", async () => {
  const user = userEvent.setup();
  const call = (file: string, path: string, state: GraphDiff['edges'][number]['state']) => ({
    from: `web/file/modules/AppInfo/${file}`,
    to: 'rust/crate/http-adapter',
    via: [path],
    state,
  });
  render(
    <ReviewPage
      review={pageWith({
        range: 'abc123..def456',
        diff: {
          nodes: [
            { id: 'rust', kind: 'stack', label: 'rust', path: '', state: 'unchanged' },
            crate('http-adapter', 'unchanged'),
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
            webModule('modules/AppInfo'),
            webFile('modules/AppInfo', 'api/app-info.ts'),
            webFile('modules/AppInfo', 'api/users.ts'),
          ],
          edges: [
            call('api/app-info.ts', '/api/info', 'removed'),
            call('api/users.ts', '/api/users', 'added'),
          ],
        },
        dangling: [{ from: 'web/file/modules/AppInfo/api/users.ts', path: '/api/app-info' }],
      })}
      notes={{
        version: 1,
        tests: '',
        summary: [],
        notes: {
          'web/file/modules/AppInfo/api/users.ts -> rust/crate/http-adapter': {
            text: 'Lists users.',
          },
        },
      }}
    />,
  );

  await showEverything(user);
  const web = await screen.findByRole('group', { name: 'web' });
  expect(buttonsIn(web)).toEqual([
    'modules/AppInfo: unchanged, no route for /api/app-info',
    'Expand modules/AppInfo',
  ]);
  await user.click(screen.getByRole('img', { name: 'No route for /api/app-info' }));
  expect(reasonsShown()).toEqual(['No route for /api/app-info']);
  expect(buttonsIn(screen.getByRole('group', { name: 'rust' }))).toEqual([
    'http-adapter: unchanged',
  ]);
  expect(
    screen.getByRole('button', {
      name: 'modules/AppInfo ⇢ http-adapter: unchanged (/api/info, /api/users)',
    }),
  ).toBeTruthy();

  await user.click(within(web).getByRole('button', { name: 'Expand modules/AppInfo' }));

  expect(
    await screen.findByRole('button', {
      name: 'api/app-info.ts ⇢ http-adapter: removed (/api/info)',
    }),
  ).toBeTruthy();
  expect(buttonsIn(within(web).getByRole('group', { name: 'modules/AppInfo' }))).toEqual([
    'api/app-info.ts: unchanged',
    'api/users.ts: unchanged, no route for /api/app-info',
  ]);
  await user.click(
    screen.getByRole('button', { name: 'api/users.ts ⇢ http-adapter: added (/api/users)' }),
  );
  expect(noteShown()).toBe('Lists users.');
});

const metricCells = (metric: string) => {
  const panel = screen.getByRole('tabpanel', { name: 'Metrics' });
  const header = within(panel)
    .getAllByRole('rowheader')
    .find(cell => cell.textContent?.startsWith(metric));
  const row = within(panel)
    .getAllByRole('row')
    .find(row => header !== undefined && row.contains(header));
  return (
    row &&
    within(row)
      .getAllByRole('cell')
      .map(cell => cell.textContent)
  );
};

test("a measured node's Metrics tab gives each measure before and after with the difference, a missing side and its difference as —, and a side without complexity as not measured, and a box's values as the highest inside it, with no functions listed without their cyclomatic; a node or an edge without metrics has no Metrics tab", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        metrics: {
          'rust/crate/application': {
            base: measured({ fanIn: 2 }),
            head: measured({
              lines: 184,
              functions: 9,
              cyclomatic: { highest: 14, total: 41 },
              abc: 31.5,
              fanOut: 5,
            }),
          },
          'rust/crate/cli-adapter': { head: { churn: 1, fanIn: 0, fanOut: 1 } },
          'rust/crate/legacy': { highestInside: true, base: measured() },
        },
      })}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'application: modified' }));
  expect(inspectorTabs()).toEqual(['Note', 'Metrics']);
  await user.click(within(inspector()).getByRole('tab', { name: 'Metrics' }));
  expect(metricCells('Lines')).toEqual(['120', '184', '+64']);
  expect(metricCells('Functions')).toEqual(['6', '9', '+3']);
  expect(metricCells('Cyclomatic, highest')).toEqual(['4', '14', '+10']);
  expect(metricCells('Cyclomatic, total')).toEqual(['19', '41', '+22']);
  expect(metricCells('ABC size')).toEqual(['18.2', '31.5', '+13.3']);
  expect(metricCells('Fan-out')).toEqual(['3', '5', '+2']);
  expect(metricCells('Fan-in')).toEqual(['2', '1', '−1']);
  expect(metricCells('Churn')).toEqual(['6', '6', '±0']);
  expect(within(inspector()).queryByText(/highest inside/)).toBeNull();
  expect(screen.queryByRole('list', { name: 'Functions by cyclomatic' })).toBeNull();

  await user.click(screen.getByRole('button', { name: 'cli-adapter: added' }));
  expect(metricCells('Lines')).toEqual(['—', 'not measured', '—']);
  expect(metricCells('Fan-out')).toEqual(['—', '1', '—']);
  await user.click(screen.getByRole('button', { name: 'legacy: removed' }));
  expect(metricCells('Lines')).toEqual(['120', '—', '—']);
  expect(within(inspector()).getByText(/highest inside/)).toBeTruthy();

  await user.click(screen.getByRole('button', { name: 'domain: unchanged' }));
  expect(inspectorTabs()).toEqual(['Note']);
  await user.click(screen.getByRole('button', { name: 'application → domain: unchanged' }));
  expect(inspectorTabs()).toEqual(['Note']);
});

const metricMarks = (metric: string) => {
  const header = within(screen.getByRole('tabpanel', { name: 'Metrics' }))
    .getAllByRole('rowheader')
    .find(cell => cell.textContent?.startsWith(metric));
  return (
    header &&
    within(header)
      .queryAllByRole('img')
      .map(mark => mark.getAttribute('aria-label'))
  );
};

test("a Metrics row is marked by the level of the node's finding on it, a hotspot marking Churn", async () => {
  const user = userEvent.setup();
  const application = 'rust/crate/application';
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        metrics: { [application]: { base: measured(), head: measured() } },
        metricFindings: [
          {
            node: 'rust/crate/domain',
            metric: 'cyclomatic',
            level: 'info',
            head: 12,
            threshold: 10,
          },
          { node: application, metric: 'cyclomatic', level: 'look', head: 14, threshold: 10 },
          { node: application, metric: 'lines', level: 'look', head: 900, threshold: 800 },
          { node: application, metric: 'abc', level: 'info', head: 31.5, threshold: 30 },
          {
            node: application,
            metric: 'hotspot',
            level: 'info',
            head: { churn: 6, cyclomatic: 14 },
            threshold: { churn: 5, cyclomatic: 10 },
          },
        ],
      })}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'application: modified' }));
  await user.click(within(inspector()).getByRole('tab', { name: 'Metrics' }));
  expect(metricMarks('Cyclomatic, highest')).toEqual(['needs a look']);
  expect(metricMarks('ABC size')).toEqual(['for information']);
  expect(metricMarks('Churn')).toEqual(['for information']);
  expect(metricMarks('Lines')).toEqual(['needs a look']);
  expect(metricMarks('Functions')).toEqual([]);
});

test("a measured file's Metrics tab lists its functions by cyclomatic base → head, a repeated name paired n-th with n-th, marked added, removed or modified, the highest head first and removed ones last", async () => {
  const user = userEvent.setup();
  const byFunction = (pairs: ReadonlyArray<readonly [string, number]>) => ({
    highest: 14,
    total: 40,
    byFunction: pairs.map(([name, cyclomatic]) => ({ name, cyclomatic })),
  });
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        metrics: {
          'rust/crate/application': {
            base: measured({
              cyclomatic: byFunction([
                ['refund_order', 4],
                ['validate', 3],
                ['legacy', 5],
                ['helper', 2],
                ['helper', 7],
              ]),
            }),
            head: measured({
              cyclomatic: byFunction([
                ['validate', 3],
                ['refund_order', 14],
                ['helper', 2],
                ['split', 6],
                ['helper', 9],
              ]),
            }),
          },
        },
      })}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'application: modified' }));
  await user.click(within(inspector()).getByRole('tab', { name: 'Metrics' }));
  const functions = screen.getByRole('list', { name: 'Functions by cyclomatic' });
  expect(
    within(functions)
      .getAllByRole('listitem')
      .map(item => item.textContent),
  ).toEqual([
    '~ refund_order 4 → 14',
    '~ helper 7 → 9',
    '+ split — → 6',
    'validate 3 → 3',
    'helper 2 → 2',
    '− legacy 5 → —',
  ]);
});

test("a selected node's Diff tab lists the patches of the files under it from their first hunk, a module's closed and a file's open with its added and removed lines marked, and stays picked from one selection to the next; a file without a patch or an edge has no Diff tab and shows its Note", async () => {
  const user = userEvent.setup();
  const patch = [
    'diff --git a/web/src/utils/x.ts b/web/src/utils/x.ts',
    '--- a/web/src/utils/x.ts',
    '+++ b/web/src/utils/x.ts',
    '@@ -1,2 +1,2 @@ export const y',
    ' export const y = 0;',
    '-export const x = 1;',
    '+export const x = 2;',
  ].join('\n');
  render(
    <ReviewPage
      review={pageWith({
        range: 'abc123..def456',
        diff: {
          nodes: [
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
            webModule('utils', 'modified'),
            webFile('utils', 'x.ts', 'modified'),
            webFile('utils', 'y.ts'),
          ],
          edges: [{ from: 'web/file/utils/y.ts', to: 'web/file/utils/x.ts', state: 'unchanged' }],
        },
        patches: [{ path: 'web/src/utils/x.ts', patch }],
      })}
    />,
  );
  const changes = () => screen.queryByRole('region', { name: 'Changes' });
  const fileShown = () =>
    within(screen.getByRole('region', { name: 'Changes' })).getByRole('group', {
      name: 'web/src/utils/x.ts',
    });

  const web = await screen.findByRole('group', { name: 'web' });
  await user.click(within(web).getByRole('button', { name: 'utils: modified' }));
  expect(inspectorTabs()).toEqual(['Note', 'Diff']);
  expect(changes()).toBeNull();
  await user.click(within(inspector()).getByRole('tab', { name: 'Diff' }));
  expect(fileShown().hasAttribute('open')).toBe(false);

  await user.click(within(web).getByRole('button', { name: 'Expand utils' }));
  const utils = await within(web).findByRole('group', { name: 'utils' });
  await user.click(within(utils).getByRole('button', { name: 'x.ts: modified' }));
  expect(within(inspector()).getByRole('tab', { selected: true }).textContent).toBe('Diff');
  const file = fileShown();
  expect(file.hasAttribute('open')).toBe(true);
  expect(within(file).getByText(/^@@ -1,2 \+1,2 @@/)).not.toBeNull();
  expect(within(file).queryByText('+++ b/web/src/utils/x.ts')).toBeNull();
  expect(
    within(file)
      .getAllByRole('insertion')
      .map(line => line.textContent),
  ).toEqual(['+export const x = 2;']);
  expect(
    within(file)
      .getAllByRole('deletion')
      .map(line => line.textContent),
  ).toEqual(['-export const x = 1;']);

  await user.click(within(utils).getByRole('button', { name: 'y.ts: unchanged' }));
  expect(inspectorTabs()).toEqual(['Note']);
  expect(changes()).toBeNull();
  expect(noteShown()).toBe('No note');

  await user.click(within(utils).getByRole('button', { name: 'x.ts: modified' }));
  await user.click(within(inspector()).getByRole('tab', { name: 'Diff' }));
  expect(changes()).not.toBeNull();
  await user.click(within(web).getByRole('button', { name: 'y.ts → x.ts: unchanged' }));
  expect(inspectorTabs()).toEqual(['Note']);
  expect(changes()).toBeNull();
});

test("the rail's changed files outside the graph open in the inspector at the changes' width, each a closed patch that opens on click, until a node is selected or the inspector closed, which hands the keyboard focus back to the rail's button", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        undrawn: [
          { path: 'README.md', patch: '--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-old\n+new' },
          { path: 'docs/a.md', patch: '--- a/docs/a.md\n+++ b/docs/a.md\n@@ -1 +1 @@\n-a\n+b' },
        ],
      })}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'Show 1 finding' }));
  const outside = 'README.md, docs/a.md: 2 changed files outside the graph';
  await user.click(screen.getByRole('button', { name: outside }));
  expect(within(inspector()).getByRole('heading', { level: 2 }).textContent).toBe(
    'Changed files outside the graph',
  );
  expect(panelWidth()).toBe('600');
  const readme = within(inspector()).getByRole('group', { name: 'README.md' });
  expect(within(inspector()).getByRole('group', { name: 'docs/a.md' })).toBeDefined();
  expect(readme.hasAttribute('open')).toBe(false);
  await user.click(within(readme).getByText('README.md'));
  expect(within(readme).getByRole('insertion').textContent).toBe('+new');

  await user.click(screen.getByRole('button', { name: 'domain: unchanged' }));
  expect(within(inspector()).getByRole('heading', { level: 2 }).textContent).toBe('domain');

  const opener = screen.getByRole('button', { name: outside });
  await user.click(opener);
  await user.click(within(inspector()).getByRole('button', { name: 'Close inspector' }));
  expect(screen.queryByRole('complementary', { name: 'Inspector' })).toBeNull();
  expect(document.activeElement).toBe(opener);
});

test("a renamed node shows the label it had under its own, also once expanded, is named with both and its old path, and its inspector's head names it with its kind, stack, state and path and what it was renamed from; a node whose label stayed shows no former one", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        range: 'abc123..def456',
        diff: {
          nodes: [
            { id: 'rust', kind: 'stack', label: 'rust', path: '', state: 'unchanged' },
            {
              ...crate('models', 'modified'),
              renamedFrom: 'crates/domain',
              formerLabel: 'domain',
            },
            {
              id: 'rust/mod/models/lib.rs',
              kind: 'file',
              label: 'lib.rs',
              parent: 'rust/crate/models',
              path: 'crates/models/src/lib.rs',
              state: 'modified',
              renamedFrom: 'crates/domain/src/lib.rs',
            },
          ],
          edges: [],
        },
      })}
    />,
  );

  const rust = await screen.findByRole('group', { name: 'rust' });
  const models = within(rust).getByRole('button', {
    name: 'models: modified, was domain, renamed from crates/domain',
  });
  expect(within(models).getByText('was domain')).not.toBeNull();

  await user.click(models);
  expect(within(inspector()).getByRole('heading', { level: 2 }).textContent).toBe('models');
  expect(within(inspector()).getByText('package · rust')).not.toBeNull();
  expect(within(inspector()).getByText('modified')).not.toBeNull();
  expect(within(inspector()).getByText('crates/models, renamed from crates/domain')).not.toBeNull();

  await user.click(within(rust).getByRole('button', { name: 'Expand models' }));
  const expanded = await within(rust).findByRole('group', { name: 'models' });
  expect(within(expanded).getByText('was domain')).not.toBeNull();
  const lib = within(expanded).getByRole('button', { name: /^lib\.rs: modified/ });
  expect(within(lib).queryByText(/was/)).toBeNull();
  await user.click(lib);
  expect(within(inspector()).getByText('file · rust')).not.toBeNull();
  expect(
    within(inspector()).getByText(
      'crates/models/src/lib.rs, renamed from crates/domain/src/lib.rs',
    ),
  ).not.toBeNull();
});

test('the Tests tab lists each changed test file with its tests as a tree, each named with its change and any label or where it moved, an unreadable one with the reason and a renamed one with its old path', () => {
  atHash('#tests');
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        tests: [
          {
            path: 'tools/visual-review/src/notes.test.ts',
            stack: 'tools/visual-review',
            renamedFrom: 'tools/visual-review/src/review-notes.test.ts',
            statements: [
              { kind: 'test', name: 'reads the notes', change: 'edited' },
              { kind: 'test', name: 'reads renames', change: 'added', label: 'todo' },
              {
                kind: 'test',
                name: 'reads flags',
                change: 'removed',
                movedTo: 'tools/visual-review/src/flags.test.ts',
              },
              {
                kind: 'test',
                name: 'reads a summary',
                change: 'added',
                movedFrom: 'tools/visual-review/src/summary.test.ts',
              },
              {
                kind: 'heading',
                name: 'the notes check',
                label: 'skip',
                children: [
                  { kind: 'test', name: 'accepts notes on crates', change: 'unchanged' },
                  { kind: 'test', name: 'names an unknown id', change: 'added' },
                  { kind: 'test', name: 'lists unplaced notes', change: 'removed' },
                ],
              },
            ],
          },
          {
            path: 'web/src/broken.test.ts',
            stack: 'web',
            unreadable: 'SyntaxError: Unexpected token (2:0)',
          },
        ],
      })}
    />,
  );

  const tests = screen.getByRole('region', { name: 'Test changes' });
  const file = within(tests).getByRole('region', { name: 'tools/visual-review/src/notes.test.ts' });
  expect(within(file).getByRole('listitem', { name: 'reads the notes: edited' })).not.toBeNull();
  expect(within(file).getByRole('listitem', { name: 'reads renames: added, todo' })).not.toBeNull();
  const movedOut = within(file).getByRole('listitem', {
    name: 'reads flags: moved to tools/visual-review/src/flags.test.ts',
  });
  expect(
    within(movedOut).getByText('moved to tools/visual-review/src/flags.test.ts'),
  ).not.toBeNull();
  expect(
    within(file).getByRole('listitem', {
      name: 'reads a summary: moved from tools/visual-review/src/summary.test.ts',
    }),
  ).not.toBeNull();
  const check = within(file).getByRole('listitem', { name: 'the notes check, skip' });
  expect(
    within(check).getByRole('listitem', { name: 'accepts notes on crates: unchanged' }),
  ).not.toBeNull();
  expect(
    within(check).getByRole('listitem', { name: 'names an unknown id: added' }),
  ).not.toBeNull();
  expect(
    within(check).getByRole('listitem', { name: 'lists unplaced notes: removed' }),
  ).not.toBeNull();
  const unreadable = within(tests).getByRole('region', { name: 'web/src/broken.test.ts' });
  expect(within(unreadable).getByText(/SyntaxError: Unexpected token \(2:0\)/)).not.toBeNull();
  expect(
    within(file).getByText(/renamed from tools\/visual-review\/src\/review-notes\.test\.ts/),
  ).not.toBeNull();
  expect(within(unreadable).queryByText(/renamed from/)).toBeNull();
  expect(within(tests).queryByText('No test changed.')).toBeNull();
});

test("the inspector's Tests tab lists the test files at or under the selected node, counting their changed tests, and is left out where none changed", async () => {
  const user = userEvent.setup();
  const testFile = (path: string, stack: string) => ({
    path,
    stack,
    statements: [{ kind: 'test' as const, name: 'reads the notes', change: 'added' as const }],
  });
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        tests: [
          testFile('crates/application/src/lib.rs', 'rust'),
          {
            path: 'crates/application/tests/export.rs',
            stack: 'rust',
            statements: [
              { kind: 'test', name: 'exports a CSV', change: 'removed' },
              {
                kind: 'heading',
                name: 'the export',
                children: [
                  { kind: 'test', name: 'names the columns', change: 'unchanged' },
                  { kind: 'test', name: 'quotes commas', change: 'edited' },
                ],
              },
            ],
          },
          testFile('tools/visual-review/src/notes.test.ts', 'tools/visual-review'),
        ],
      })}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'application: modified' }));
  expect(inspectorTabs()).toEqual(['Note', 'Tests 3']);
  await user.click(within(inspector()).getByRole('tab', { name: 'Tests 3' }));
  expect(
    within(screen.getByRole('tabpanel', { name: 'Tests' }))
      .getAllByRole('region')
      .map(file => file.getAttribute('aria-label')),
  ).toEqual(['crates/application/src/lib.rs', 'crates/application/tests/export.rs']);
  await user.click(screen.getByRole('button', { name: 'application → domain: unchanged' }));
  expect(inspectorTabs()).toEqual(['Note']);
  await user.click(screen.getByRole('button', { name: 'domain: unchanged' }));
  expect(inspectorTabs()).toEqual(['Note']);
});

test("a node's Tests tab also lists the test files named after a file inside it, wherever they sit in its stack", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        range: 'abc123..def456',
        diff: {
          nodes: [
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
            webModule('orders', 'modified'),
            webFile('orders', 'refund.ts', 'modified'),
          ],
          edges: [],
        },
        tests: [
          {
            path: 'web/tests/refund.test.ts',
            stack: 'web',
            statements: [{ kind: 'test', name: 'refunds twice', change: 'added' }],
          },
        ],
      })}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'orders: modified' }));
  await user.click(within(inspector()).getByRole('tab', { name: 'Tests 1' }));
  expect(
    within(screen.getByRole('tabpanel', { name: 'Tests' }))
      .getAllByRole('region')
      .map(file => file.getAttribute('aria-label')),
  ).toEqual(['web/tests/refund.test.ts']);
});

test("a node's Tests tab counts a test moved between two of its files once", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        tests: [
          {
            path: 'crates/application/src/lib.rs',
            stack: 'rust',
            statements: [
              { kind: 'test', name: 'reads the notes', change: 'edited' },
              {
                kind: 'test',
                name: 'exports a CSV',
                change: 'removed',
                movedTo: 'crates/application/tests/export.rs',
              },
            ],
          },
          {
            path: 'crates/application/tests/export.rs',
            stack: 'rust',
            statements: [
              {
                kind: 'test',
                name: 'exports a CSV',
                change: 'added',
                movedFrom: 'crates/application/src/lib.rs',
              },
            ],
          },
        ],
      })}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'application: modified' }));
  expect(inspectorTabs()).toEqual(['Note', 'Tests 2']);
});

test("'Changed + 1 hop' starts ticked, hiding what is more than one edge from a change; going to a shown node or edge keeps it, and going to a hidden node unticks it", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        range: 'abc123..def456',
        diff: {
          nodes: [
            { id: 'rust', kind: 'stack', label: 'rust', path: '', state: 'unchanged' },
            crate('domain', 'unchanged'),
            crate('application', 'modified'),
            crate('cli-adapter', 'unchanged'),
          ],
          edges: [
            dependency('application', 'domain', 'unchanged'),
            dependency('cli-adapter', 'domain', 'unchanged'),
          ],
        },
      })}
      notes={{
        version: 1,
        tests: '',
        summary: [
          { text: 'Read the use case.', target: 'rust/crate/application' },
          { text: 'See what it uses.', target: 'rust/crate/application -> rust/crate/domain' },
          { text: 'Check the CLI.', target: 'rust/crate/cli-adapter' },
        ],
        notes: {},
      }}
    />,
  );
  const rust = await screen.findByRole('group', { name: 'rust' });
  const hop = screen.getByRole('checkbox', { name: 'Changed + 1 hop' });
  expect(hop).toHaveProperty('checked', true);
  expect(buttonsIn(rust)).toEqual([
    'application → domain: unchanged',
    'domain: unchanged',
    'application: modified',
  ]);
  const summary = screen.getByRole('region', { name: 'Summary' });
  await user.click(within(summary).getByRole('button', { name: 'Read the use case.' }));
  await user.click(within(summary).getByRole('button', { name: 'See what it uses.' }));
  expect(hop).toHaveProperty('checked', true);
  await user.click(within(summary).getByRole('button', { name: 'Check the CLI.' }));

  expect(hop).toHaveProperty('checked', false);
  await waitFor(() =>
    expect(document.activeElement).toBe(
      within(rust).getByRole('button', { name: 'cli-adapter: unchanged' }),
    ),
  );
});

test("with 'Changed + 1 hop' ticked and nothing drawn changed, the graph gives way to a line saying so", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        range: 'abc123..def456',
        diff: {
          nodes: [
            { id: 'rust', kind: 'stack', label: 'rust', path: '', state: 'unchanged' },
            crate('domain', 'unchanged'),
          ],
          edges: [],
        },
      })}
    />,
  );
  expect(await screen.findByText('Nothing in the graph changed.')).toBeTruthy();
  expect(screen.queryByRole('group', { name: 'rust' })).toBeNull();

  await showEverything(user);

  await screen.findByRole('group', { name: 'rust' });
  expect(screen.queryByText('Nothing in the graph changed.')).toBeNull();
});

const withChangesUnderApplication = {
  ...review,
  patches: [
    {
      path: 'crates/application/src/lib.rs',
      patch: [
        'diff --git a/crates/application/src/lib.rs b/crates/application/src/lib.rs',
        '--- a/crates/application/src/lib.rs',
        '+++ b/crates/application/src/lib.rs',
        '@@ -1 +1 @@',
        '-pub mod a;',
        '+pub mod b;',
      ].join('\n'),
    },
  ],
};

const panelWidth = () =>
  screen.getByRole('separator', { name: 'Panel width' }).getAttribute('aria-valuenow');

test('a selected node opens its panel beside a divider that gives its width: 360 for a note alone, 600 with changes; arrow keys move the divider, other keys leave it, and it stops at 280 and where the graph, right of the findings rail, would get narrower than 320; the width it sets holds for later selections', async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={pageWith(withChangesUnderApplication)} />);

  const rust = await screen.findByRole('group', { name: 'rust' });
  vi.spyOn(screen.getByRole('group', { name: 'Graph' }), 'getBoundingClientRect').mockReturnValue(
    DOMRect.fromRect({ x: 101, y: 0, width: 600, height: 400 }),
  );
  expect(screen.queryByRole('separator')).toBeNull();

  await user.click(within(rust).getByRole('button', { name: 'application: modified' }));
  expect(panelWidth()).toBe('600');

  await user.click(within(rust).getByRole('button', { name: 'domain: unchanged' }));
  expect(panelWidth()).toBe('360');

  await user.click(screen.getByRole('separator', { name: 'Panel width' }));
  await user.keyboard('{ArrowRight}');
  expect(panelWidth()).toBe('320');
  await user.keyboard('{ArrowRight}');
  expect(panelWidth()).toBe('280');
  await user.keyboard('{ArrowRight}');
  expect(panelWidth()).toBe('280');

  await user.keyboard('{ArrowLeft>6/}');
  expect(panelWidth()).toBe('520');
  await user.keyboard('{ArrowLeft}');
  expect(panelWidth()).toBe('555');
  await user.keyboard('{Tab}');
  expect(panelWidth()).toBe('555');

  await user.click(within(rust).getByRole('button', { name: 'application: modified' }));
  expect(panelWidth()).toBe('555');
});

test('dragging the divider sets the panel width until the button is let go, within the same limits', async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={pageWith(review)} />);
  const rust = await screen.findByRole('group', { name: 'rust' });
  await user.click(within(rust).getByRole('button', { name: 'domain: unchanged' }));
  const divider = screen.getByRole('separator', { name: 'Panel width' });

  await user.pointer([
    { keys: '[MouseLeft>]', target: divider, coords: { clientX: 600 } },
    { coords: { clientX: 450 } },
  ]);
  expect(panelWidth()).toBe('510');
  await user.pointer({ coords: { clientX: 800 } });
  expect(panelWidth()).toBe('280');

  await user.pointer({ keys: '[/MouseLeft]' });
  await user.pointer({ coords: { clientX: 500 } });
  expect(panelWidth()).toBe('280');
  expect(fireEvent.pointerDown(divider, { clientX: 500 }), 'a drag selects no page text').toBe(
    false,
  );
});

const churned = (churn: number) => ({ head: { churn, fanIn: 0, fanOut: 0 } });

const eightCrates = {
  range: 'abc123..def456',
  diff: {
    nodes: [
      { id: 'rust', kind: 'stack' as const, label: 'rust', path: '', state: 'unchanged' as const },
      crate('domain', 'modified'),
      crate('application', 'modified'),
      crate('billing', 'modified'),
      crate('shipping', 'modified'),
      crate('search', 'modified'),
      crate('cli-adapter', 'added'),
      crate('legacy', 'removed'),
      crate('audit', 'modified'),
    ],
    edges: [],
  },
};

const scaleSteps = () =>
  within(screen.getByRole('list', { name: 'Scale' }))
    .getAllByRole('listitem')
    .map(step => step.textContent);

const colourBy = (name: string) =>
  within(screen.getByRole('group', { name: 'Colour by' })).getByRole('button', { name });

test('Colour by starts on Change; on Churn each measured node is named with its churn and the step of the ramp holding it, cut at 3, 6 and 9, a removed node by its base, an unmeasured one with nothing; back on Change they go', async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        ...eightCrates,
        metrics: {
          'rust/crate/domain': { base: { churn: 7, fanIn: 0, fanOut: 0 }, ...churned(2) },
          'rust/crate/cli-adapter': churned(3),
          'rust/crate/billing': churned(5),
          'rust/crate/shipping': churned(6),
          'rust/crate/search': churned(8),
          'rust/crate/application': churned(9),
          'rust/crate/legacy': { base: { churn: 4, fanIn: 0, fanOut: 0 } },
        },
      })}
    />,
  );
  const rust = await screen.findByRole('group', { name: 'rust' });
  expect(colourBy('Change').getAttribute('aria-pressed')).toBe('true');
  expect(colourBy('Churn').getAttribute('aria-pressed')).toBe('false');
  expect(screen.getByRole('list', { name: 'Legend' })).toBeTruthy();
  expect(screen.queryByRole('list', { name: 'Scale' })).toBeNull();

  await user.click(colourBy('Churn'));
  expect(screen.queryByRole('list', { name: 'Legend' })).toBeNull();
  expect(scaleSteps()).toEqual(['0–2', '3–5', '6–8', '9+']);
  expect(colourBy('Churn').getAttribute('aria-pressed')).toBe('true');
  expect(colourBy('Change').getAttribute('aria-pressed')).toBe('false');
  expect(buttonsIn(rust)).toEqual([
    'domain: modified, churn 2 (0–2)',
    'application: modified, churn 9 (9+)',
    'billing: modified, churn 5 (3–5)',
    'shipping: modified, churn 6 (6–8)',
    'search: modified, churn 8 (6–8)',
    'cli-adapter: added, churn 3 (3–5)',
    'legacy: removed, churn 4 (3–5)',
    'audit: modified',
  ]);

  await user.click(colourBy('Change'));
  expect(within(rust).getByRole('button', { name: 'application: modified' })).toBeTruthy();
  expect(screen.getByRole('list', { name: 'Legend' })).toBeTruthy();
  expect(screen.queryByRole('list', { name: 'Scale' })).toBeNull();
});

const complex = (highest: number) => measured({ cyclomatic: { highest, total: highest } });

test("on Complexity each node is named with its head's highest cyclomatic and the step holding it, cut at 5, 8 and 11; a removed node or a head without complexity with nothing", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        ...eightCrates,
        metrics: {
          'rust/crate/domain': { base: complex(12), head: complex(4) },
          'rust/crate/application': { head: complex(5) },
          'rust/crate/billing': { head: complex(7) },
          'rust/crate/shipping': { head: complex(8) },
          'rust/crate/search': { head: complex(10) },
          'rust/crate/cli-adapter': { head: complex(11) },
          'rust/crate/legacy': { base: complex(12) },
          'rust/crate/audit': churned(9),
        },
      })}
    />,
  );
  const rust = await screen.findByRole('group', { name: 'rust' });

  await user.click(colourBy('Complexity'));
  expect(colourBy('Complexity').getAttribute('aria-pressed')).toBe('true');
  expect(scaleSteps()).toEqual(['0–4', '5–7', '8–10', '11+']);
  expect(buttonsIn(rust)).toEqual([
    'domain: modified, cyclomatic 4 (0–4)',
    'application: modified, cyclomatic 5 (5–7)',
    'billing: modified, cyclomatic 7 (5–7)',
    'shipping: modified, cyclomatic 8 (8–10)',
    'search: modified, cyclomatic 10 (8–10)',
    'cli-adapter: added, cyclomatic 11 (11+)',
    'legacy: removed',
    'audit: modified',
  ]);
});
