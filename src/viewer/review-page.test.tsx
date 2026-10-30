// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, onTestFinished, test, vi } from 'vitest';
import type { GraphDiff } from '../core/diff-graphs.ts';
import type { PageData } from '../core/page.ts';
import { layoutDiff } from './layout.ts';
import { ReviewPage } from './review-page.tsx';

const frameOfWidth = (width: number) =>
  class implements ResizeObserver {
    readonly #report: ResizeObserverCallback;
    constructor(report: ResizeObserverCallback) {
      this.#report = report;
    }
    observe(target: Element) {
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
    }
    unobserve() {}
    disconnect() {}
  };

const WIDE_FRAME = 1200;

vi.stubGlobal('ResizeObserver', frameOfWidth(WIDE_FRAME));

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

const pageWith = (data: Pick<PageData, 'range' | 'diff'> & Partial<PageData>): PageData => ({
  version: '0.1.0',
  dangling: [],
  patches: [],
  undrawn: [],
  tests: [],
  skipped: [],
  ...data,
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

const noteShown = () => screen.getByRole('complementary', { name: 'Note' }).textContent;

test('draws every crate and dependency inside the rust stack with its change state, and opens no note panel until one is clicked', async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={pageWith(review)} />);

  const rust = await screen.findByRole('group', { name: 'rust' });
  expect(screen.getAllByRole('group')).toEqual([
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
  expect(screen.queryByRole('complementary', { name: 'Note' })).toBeNull();
  expect(screen.queryByRole('region', { name: 'Summary' })).toBeNull();
  expect(screen.queryByRole('region', { name: 'Calls with no route' })).toBeNull();
  expect(screen.queryByRole('region', { name: 'Not in the graph' })).toBeNull();

  await user.click(within(rust).getByRole('button', { name: 'legacy: removed' }));
  expect(noteShown()).toBe('No note');
});

type FrameOptions = { readonly width: number; readonly windowHeight: number };

const renderInFrame = (page: PageData, { width, windowHeight }: FrameOptions) => {
  vi.stubGlobal('ResizeObserver', frameOfWidth(width));
  const innerHeight = vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(windowHeight);
  onTestFinished(() => {
    vi.stubGlobal('ResizeObserver', frameOfWidth(WIDE_FRAME));
    innerHeight.mockRestore();
  });
  return render(<ReviewPage review={page} />);
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
  expect(screen.queryByRole('complementary', { name: 'Note' })).toBeNull();

  await drag({ clientX: 103, clientY: 100 });
  expect(viewOf(rust)).toBe(pannedBy(42, 31));
  expect(noteShown()).toBe('No note');
});

test('the wheel pans the graph, and with Ctrl or ⌘ zooms it at the pointer, never scrolling the page', async () => {
  const graph = await layoutDiff(review.diff);
  renderInFrame(pageWith(review), { width: graph.width / 2, windowHeight: 10_000 });
  const rust = await screen.findByRole('group', { name: 'rust' });
  const frame = screen.getByRole('group', { name: 'Graph' });
  vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue(
    DOMRect.fromRect({ x: 10, y: 20, width: graph.width / 2, height: graph.height / 2 }),
  );

  expect(fireEvent.wheel(frame, { ctrlKey: true, deltaY: -100, clientX: 10, clientY: 20 })).toBe(
    false,
  );
  expect(zoomShown()).toBe('100%');
  expect(viewOf(rust)).toBe('translate(0 0) scale(1)');
  expect(fireEvent.wheel(frame, { deltaX: 30, deltaY: 20 })).toBe(false);
  expect(viewOf(rust)).toBe('translate(-30 -20) scale(1)');
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
  await user.keyboard('0');
  expect(viewOf(rust)).toBe('translate(0 0) scale(0.5)');
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

test("a PR's page names the PR above its range, as a link to it", async () => {
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

  expect(screen.getByRole('link', { name: 'PR #7 Add the cli crate' })).toHaveProperty(
    'href',
    'https://github.com/acme/shop/pull/7',
  );
  await screen.findByRole('group', { name: 'rust' });
});

test('a reader skipped for want of its tool is named in the header with the stacks it did not read', async () => {
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        skipped: [{ reader: 'rust', tool: 'cargo', stacks: ['rust', 'rust~2'] }],
      })}
    />,
  );

  expect(screen.getByRole('alert').textContent).toBe(
    'rust, rust~2 not read: cargo not found on PATH',
  );
  await screen.findByRole('group', { name: 'rust' });
});

test.for([
  {
    range: '646f56cfd31dbe78c3b93e793c174efe85d8f666..fe2b80f6d56a89db7649e4e59a7b73790e5f8202',
    heading: 'Structure 646f56c..fe2b80f',
  },
  { range: 'main..my-branch', heading: 'Structure main..my-branch' },
])('the header and the graph name $range by short SHAs', async ({ range, heading }) => {
  render(<ReviewPage review={pageWith({ ...review, range })} />);

  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(heading);
  await screen.findByRole('group', { name: 'rust' });
  expect(screen.getByTitle(heading).tagName).toBe('title');
});

test('a short SHA in the header shows its full SHA on hover', async () => {
  render(
    <ReviewPage
      review={pageWith({
        ...review,
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

test('the summary lists its items and then every flagged note, and an item with a target takes focus to it and shows its note', async () => {
  const user = userEvent.setup();
  render(
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
    'new dependency direction: The CLI drives the use case.',
    'removed but depended on: Domain still reaches it.',
  ]);
  expect(
    within(summary)
      .getAllByRole('button')
      .map(button => button.textContent),
  ).toEqual([
    'The CLI is a new adapter.',
    'new dependency direction: The CLI drives the use case.',
    'removed but depended on: Domain still reaches it.',
  ]);

  const focus = vi.spyOn(SVGElement.prototype, 'focus');
  onTestFinished(() => focus.mockRestore());
  await user.click(within(summary).getByRole('button', { name: 'The CLI is a new adapter.' }));
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'cli-adapter: added' }));
  expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  expect(noteShown()).toBe('A second way in.');

  await user.click(within(summary).getByRole('button', { name: /^new dependency direction/ }));
  expect(document.activeElement).toBe(
    screen.getByRole('button', {
      name: 'cli-adapter → application: added, flagged: new dependency direction',
    }),
  );
  expect(noteShown()).toBe('The CLI drives the use case.');
  expect(screen.queryByRole('region', { name: 'Unplaced notes' })).toBeNull();
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

test("modules open collapsed, joined by their files' imports; a module's toggle expands it into its files and back; a note on a hidden import shows on the edge it merges into; a summary item on a hidden file or import expands what hides it and focuses it, without pulling focus back later", async () => {
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
  await user.click(screen.getByRole('button', { name: 'reaches into utils: New helper.' }));

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

test("web calls to API routes are drawn between the stacks, named by their paths, merged while their module is collapsed and split by file once it's expanded; a call with no route marks the node holding it and is listed", async () => {
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
  expect(
    within(screen.getByRole('region', { name: 'Calls with no route' }))
      .getAllByRole('listitem')
      .map(item => item.textContent),
  ).toEqual(['/api/app-info from web/src/modules/AppInfo/api/users.ts']);
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

test("selecting a node lists the patches of the files under it from their first hunk, a module's closed and a file's open with its added and removed lines marked; a file without a patch or an edge lists none", async () => {
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
  expect(fileShown().hasAttribute('open')).toBe(false);

  await user.click(within(web).getByRole('button', { name: 'Expand utils' }));
  const utils = await within(web).findByRole('group', { name: 'utils' });
  await user.click(within(utils).getByRole('button', { name: 'x.ts: modified' }));
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
  expect(changes()).toBeNull();

  await user.click(within(utils).getByRole('button', { name: 'x.ts: modified' }));
  expect(changes()).not.toBeNull();
  await user.click(within(web).getByRole('button', { name: 'y.ts → x.ts: unchanged' }));
  expect(changes()).toBeNull();
});

test('changed files outside the graph are listed under their own heading, each a closed patch that opens on click', async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        undrawn: [
          { path: 'README.md', patch: '--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-old\n+new' },
        ],
      })}
    />,
  );

  await screen.findByRole('group', { name: 'rust' });
  const readme = within(screen.getByRole('region', { name: 'Not in the graph' })).getByRole(
    'group',
    { name: 'README.md' },
  );
  expect(readme.hasAttribute('open')).toBe(false);
  await user.click(within(readme).getByText('README.md'));
  expect(within(readme).getByRole('insertion').textContent).toBe('+new');
});

test('a renamed node shows the label it had under its own, also once expanded, is named with both and its old path, and its panel says what it was renamed from; a node whose label stayed shows no former one', async () => {
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
  expect(noteShown()).toContain('Renamed from crates/domain');

  await user.click(within(rust).getByRole('button', { name: 'Expand models' }));
  const expanded = await within(rust).findByRole('group', { name: 'models' });
  expect(within(expanded).getByText('was domain')).not.toBeNull();
  const lib = within(expanded).getByRole('button', { name: /^lib\.rs: modified/ });
  expect(within(lib).queryByText(/was/)).toBeNull();
});

test('the tests section lists each changed test file with its tests as a tree, each named with its change and any label or where it moved, an unreadable one with the reason and a renamed one with its old path', async () => {
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        tests: [
          {
            path: 'tools/visual-review/src/notes.test.ts',
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
          { path: 'web/src/broken.test.ts', unreadable: 'SyntaxError: Unexpected token (2:0)' },
        ],
      })}
    />,
  );

  await screen.findByRole('group', { name: 'rust' });
  const tests = screen.getByRole('region', { name: 'Tests' });
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

test('the tests section says so when no test changed', async () => {
  render(<ReviewPage review={pageWith({ ...review, tests: [] })} />);

  await screen.findByRole('group', { name: 'rust' });
  expect(
    within(screen.getByRole('region', { name: 'Tests' })).getByText('No test changed.'),
  ).not.toBeNull();
});

test("selecting a node narrows the tests section to the test files at or under it, and says so when none changed there, under Claude's tests line", async () => {
  const user = userEvent.setup();
  const testFile = (path: string) => ({
    path,
    statements: [{ kind: 'test' as const, name: 'reads the notes', change: 'added' as const }],
  });
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        tests: [
          testFile('crates/application/src/lib.rs'),
          testFile('crates/application/tests/export.rs'),
          testFile('tools/visual-review/src/notes.test.ts'),
        ],
      })}
      notes={{
        version: 1,
        summary: [],
        tests: 'The notes check is pinned; the CLI is not.',
        notes: {},
      }}
    />,
  );
  const tests = screen.getByRole('region', { name: 'Tests' });
  const filesListed = () =>
    within(tests)
      .queryAllByRole('region')
      .map(file => file.getAttribute('aria-label'));

  expect(filesListed()).toHaveLength(3);
  await user.click(await screen.findByRole('button', { name: 'application: modified' }));
  expect(filesListed()).toEqual([
    'crates/application/src/lib.rs',
    'crates/application/tests/export.rs',
  ]);
  expect(within(tests).queryByText('No test changed here.')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'domain: unchanged' }));
  expect(filesListed()).toEqual([]);
  expect(within(tests).getByText('No test changed here.')).not.toBeNull();
  expect(within(tests).getByText('The notes check is pinned; the CLI is not.')).not.toBeNull();
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

test('a selected node opens its panel beside a divider that gives its width: 360 for a note alone, 600 with changes; arrow keys move the divider, other keys leave it, and it stops at 280 and where the graph would get narrower than 320; the width it sets holds for later selections', async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={pageWith(withChangesUnderApplication)} />);

  const rust = await screen.findByRole('group', { name: 'rust' });
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

  await user.keyboard('{ArrowLeft>8/}');
  expect(panelWidth()).toBe('600');
  await user.keyboard('{ArrowLeft}');
  expect(panelWidth()).toBe('632');
  await user.keyboard('{Tab}');
  expect(panelWidth()).toBe('632');

  await user.click(within(rust).getByRole('button', { name: 'application: modified' }));
  expect(panelWidth()).toBe('632');
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
