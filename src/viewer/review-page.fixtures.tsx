/* The page tests' shared fixtures and setup: helpers, page data and the jsdom stubs. */
import { act, configure, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, onTestFinished, vi } from 'vitest';
import type { GraphDiff } from '../core/diff-graphs.ts';
import type { Finding } from '../core/findings.ts';
import type { ReviewNotes } from '../core/notes.ts';
import type { PageData } from '../core/page.ts';
import type { PreviousComment } from '../core/previous-comments.ts';
import type { Reach } from '../core/read-reaches.ts';
import type { Commit, SymbolFile } from '../core/reading.ts';
import type { Comment, Review } from '../core/review.ts';
import type { ChangedSince, SinceReview } from '../core/since-review.ts';
import type { SymbolStatement } from '../core/symbol-changes.ts';
import { findingOn, measured, pageWith } from '../test-support/page-data.ts';
import { layoutDiff } from './layout.ts';
import { ReviewPage } from './review-page.tsx';

export const frameOfWidth = (width: number) => {
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

export const WIDE_FRAME = 1200;

vi.stubGlobal('ResizeObserver', frameOfWidth(WIDE_FRAME).Observer);

export const scrolledIntoView = vi.fn();

Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: scrolledIntoView });

export const scrolledTo = vi.fn();
vi.stubGlobal('scrollTo', scrolledTo);
export const scrolledBy = vi.fn();
vi.stubGlobal('scrollBy', scrolledBy);

export type Diffed = GraphDiff['nodes'][number]['state'];

export const crate = (name: string, state: Diffed) => ({
  id: `rust/crate/${name}`,
  kind: 'package' as const,
  label: name,
  parent: 'rust',
  path: `crates/${name}`,
  state,
});

export const dependency = (
  from: string,
  to: string,
  state: GraphDiff['edges'][number]['state'],
) => ({
  from: `rust/crate/${from}`,
  to: `rust/crate/${to}`,
  state,
});

export const review = {
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

configure({ asyncUtilTimeout: 3000 });

await layoutDiff(review.diff);

export const shown = (name: string) =>
  within(screen.getByRole('group', { name: 'Show' })).getByRole('button', { name });

export const showEverything = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(shown('Everything'));

/** Opens the graph's View menu, where Colour by and All edges are, unless it is open. */
export const openView = async (user: ReturnType<typeof userEvent.setup>) => {
  const view = screen.getByRole('button', { name: 'View' });
  if (view.getAttribute('aria-expanded') !== 'true') await user.click(view);
};

export const allEdges = async (user: ReturnType<typeof userEvent.setup>) => {
  await openView(user);
  return screen.getByRole('checkbox', { name: 'All edges' });
};

/** Opens Start here's list of what is for information, where the lenses are, unless it is open. */
export const openInformation = async (user: ReturnType<typeof userEvent.setup>) => {
  const opener = await screen.findByRole('button', { name: /for information$|^what was checked$/ });
  if (opener.getAttribute('aria-expanded') !== 'true') await user.click(opener);
};

export const cardDepth = (name: string) =>
  within(screen.getByRole('group', { name: 'Cards' })).getByRole('button', { name });

export const lenses = async (user: ReturnType<typeof userEvent.setup>) => {
  await openInformation(user);
  return within(screen.getByRole('group', { name: 'Lenses' }));
};

export const openReview = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'Review' }));

export const write = async (
  user: ReturnType<typeof userEvent.setup>,
  box: HTMLElement,
  text: string,
) => {
  await user.click(box);
  await user.paste(text);
};

export const sentReview = (sent: Partial<Review>): Review => ({
  version: 6,
  verdict: 'comment',
  reviewed: { range: review.range },
  read: [],
  resolved: [],
  comments: [],
  ...sent,
});

export const inspector = () => screen.getByRole('complementary', { name: 'Inspector' });

export const testedBy = () => screen.getByRole('region', { name: 'Tested by' });

export const noteLines = () =>
  within(within(inspector()).getByRole('region', { name: 'Note' }))
    .getAllByRole('paragraph')
    .map(line => line.textContent);

export const noteShown = () => noteLines()[0];

export const fold = (name: string) => within(inspector()).queryByRole('region', { name });

export const openFold = (user: ReturnType<typeof userEvent.setup>, name: string) =>
  user.click(within(inspector()).getByRole('button', { name, expanded: false }));

export const fullDiffOpen = () =>
  within(inspector()).getByRole('button', { name: 'Full diff' }).getAttribute('aria-expanded') ===
  'true';

export const findingsShown = () =>
  within(inspector())
    .queryAllByRole('listitem')
    .map(item => item.textContent);

export const partComment = async (user: ReturnType<typeof userEvent.setup>) => {
  const part = within(inspector()).queryByRole('heading', { level: 2 })?.textContent;
  const opener = within(inspector()).queryByRole('button', { name: `Comment on ${part}` });
  if (opener?.getAttribute('aria-expanded') === 'false') await user.click(opener);
  return within(inspector()).getByRole('textbox', { name: 'Your comment' });
};

export const verdict = (name: string) =>
  within(screen.getByRole('radiogroup', { name: 'Verdict' })).getByRole('radio', { name });

export const suggestedVerdict = () =>
  within(screen.getByRole('radiogroup', { name: 'Verdict' })).getByRole('radio', {
    description: 'suggested',
  });

export const findingInRail = (target: string) =>
  within(screen.getByRole('complementary', { name: 'Findings' }))
    .getByRole('button', { name: new RegExp(`^${target}: `) })
    .closest('li') ?? screen.getByRole('list', { name: 'no such finding' });

export const tray = () => screen.getByRole('region', { name: 'Review tray' });

export const pickKind = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  await partComment(user);
  await user.click(
    within(within(inspector()).getByRole('radiogroup', { name: 'Comment kind' })).getByRole(
      'radio',
      {
        name,
      },
    ),
  );
};

export type FrameOptions = {
  readonly width: number;
  readonly windowHeight: number;
  readonly notes?: ReviewNotes;
};

export const renderInFrame = (page: PageData, { width, windowHeight, notes }: FrameOptions) => {
  const frame = frameOfWidth(width);
  vi.stubGlobal('ResizeObserver', frame.Observer);
  const innerHeight = vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(windowHeight);
  onTestFinished(() => {
    vi.stubGlobal('ResizeObserver', frameOfWidth(WIDE_FRAME).Observer);
    innerHeight.mockRestore();
  });
  return { ...render(<ReviewPage review={page} notes={notes} />), resize: frame.resize };
};

export const zoomShown = () => screen.getByRole('status', { name: 'Zoom' }).textContent;

export const viewOf = (stack: HTMLElement) => stack.parentElement?.getAttribute('transform');

/** The stack's view, to a millionth of a pixel: the frame's own sums land a float away. */
export const expectView = (stack: HTMLElement, x: number, y: number, scale: number) => {
  const [, shownX, shownY, shownScale] =
    /translate\(([^ ]+) ([^)]+)\) scale\(([^)]+)\)/.exec(viewOf(stack) ?? '') ?? [];
  expect(Number(shownX)).toBeCloseTo(x, 6);
  expect(Number(shownY)).toBeCloseTo(y, 6);
  expect(Number(shownScale)).toBeCloseTo(scale, 6);
};

export const onScreen = (
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

export const atHash = (hash: string) => history.replaceState(null, '', hash);

export const currentTab = () =>
  within(screen.getByRole('navigation', { name: 'Review' })).getByRole('link', { current: 'page' })
    .textContent;

export const testsShown = () =>
  within(screen.getByRole('region', { name: 'Test changes' }))
    .queryAllByRole('region')
    .map(file => file.getAttribute('aria-label'));

export const take = () => within(inspector()).queryByRole('button', { name: 'Take' });

export const commentKind = (name: string) =>
  within(within(inspector()).getByRole('radiogroup', { name: 'Comment kind' })).getByRole('radio', {
    name,
  });

export const lensChips = () =>
  within(screen.getByRole('group', { name: 'Lenses' }))
    .getAllByRole('button')
    .map(chip => {
      const count = (level: string, mark: string) => {
        const shown = within(chip).queryByRole('img', { name: level })?.parentElement?.textContent;
        return shown ? ` ${mark}${shown}` : '';
      };
      return `${chip.textContent?.replace(/\d/g, '')}${count('for information', '○')}${count('needs a look', '▲')} ${chip.getAttribute('aria-pressed')}`;
    });

export const lensRow = (lens: string) =>
  within(screen.getByRole('list', { name: `${lens} dimensions` }))
    .getAllByRole('listitem')
    .map(item => {
      const count = (level: string, mark: string) => {
        const shown = within(item).queryByRole('img', { name: level })?.parentElement?.textContent;
        return shown ? ` ${mark}${shown}` : '';
      };
      return `${item.textContent?.replace(/\d/g, '')}${count('for information', '○')}${count('needs a look', '▲')}`;
    });

export const rowsOf = (order: HTMLElement) =>
  within(order)
    .getAllByRole('listitem')
    .map(row => within(row).getByRole('button').textContent);

export const walkedReview = () =>
  pageWith({
    ...review,
    range: `walk-${crypto.randomUUID()}`,
    readingOrder: {
      parts: ['rust/crate/application', 'rust/crate/cli-adapter', 'rust/crate/legacy'],
      cycles: [],
    },
  });

export const selectedPart = () =>
  within(inspector()).getByRole('heading', { level: 2 }).textContent;

export const headingOfPart = () => within(inspector()).getByRole('heading', { level: 2 });

export const readingOrder = () => screen.getByRole('navigation', { name: 'Reading order' });

export const readRows = () =>
  within(readingOrder())
    .getAllByRole('listitem')
    .filter(row => within(row).queryByRole('img', { name: 'read' }) !== null)
    .map(row => within(row).getByRole('button').textContent);

export const webModule = (label: string, state: Diffed = 'unchanged') => ({
  id: `web/module/${label}`,
  kind: 'module' as const,
  label,
  parent: 'web',
  path: `web/src/${label}`,
  state,
});

export const webFile = (module: string, label: string, state: Diffed = 'unchanged') => ({
  id: `web/file/${module}/${label}`,
  kind: 'file' as const,
  label,
  parent: `web/module/${module}`,
  path: `web/src/${module}/${label}`,
  state,
});

export const webImport = (
  from: string,
  to: string,
  state: GraphDiff['edges'][number]['state'],
) => ({
  from: `web/file/${from}`,
  to: `web/file/${to}`,
  state,
});

export const buttonsIn = (element: HTMLElement) =>
  within(element)
    .getAllByRole('button')
    .map(drawn => drawn.getAttribute('aria-label'));

export const webFilesReview = (count: number) => ({
  range: 'abc123..def456',
  diff: {
    nodes: [
      { id: 'web', kind: 'stack' as const, label: 'web', path: '', state: 'unchanged' as const },
      webModule('utils', 'modified'),
      ...Array.from({ length: count }, (_, at) => webFile('utils', `${at}.ts`, 'modified')),
    ],
    edges: [],
  },
});

export const findingsOnFiles = (
  { count, files }: { readonly count: number; readonly files: number },
  overrides: Partial<Finding>,
) =>
  Array.from({ length: count }, (_, at) =>
    findingOn(`web/file/utils/${at % files}.ts`, {
      id: `${overrides.check}:${at}`,
      title: `said ${at}`,
      ...overrides,
    }),
  );

export const metricCells = (metric: string) => {
  const panel = screen.getByRole('region', { name: 'Metrics' });
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

export const metricMarks = (metric: string) => {
  const header = within(screen.getByRole('region', { name: 'Metrics' }))
    .getAllByRole('rowheader')
    .find(cell => cell.textContent?.startsWith(metric));
  return (
    header &&
    within(header)
      .queryAllByRole('img')
      .map(mark => mark.getAttribute('aria-label'))
  );
};

export const pageWithQuietTests = () =>
  pageWith({
    range: review.range,
    diff: {
      nodes: [
        { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
        topFile('total.ts', 'modified'),
        topFile('quiet.ts', 'modified'),
      ],
      edges: [],
    },
    tests: [
      {
        path: 'total.test.ts',
        stack: 'web',
        statements: [
          { kind: 'test', name: 'rounds', change: 'unchanged' },
          { kind: 'test', name: 'rounds', change: 'edited' },
          {
            kind: 'heading',
            name: 'Till',
            children: [{ kind: 'test', name: 'opens', change: 'unchanged' }],
          },
          {
            kind: 'heading',
            name: 'Cart',
            children: [
              { kind: 'test', name: 'holds', change: 'unchanged' },
              { kind: 'test', name: 'adds tax', change: 'added' },
            ],
          },
        ],
      },
      {
        path: 'quiet.test.ts',
        stack: 'web',
        statements: [
          { kind: 'test', name: 'shifts', change: 'edited' },
          { kind: 'test', name: 'stays', change: 'unchanged' },
        ],
      },
    ],
  });

export const testedByRows = () =>
  within(testedBy())
    .getAllByRole('listitem')
    .map(row => row.getAttribute('aria-label'));

export const reachOf = (node: string, name: string, uses: Reach['uses']): Reach => ({
  node,
  id: `${node}#${name}`,
  label: `function ${name}`,
  how: 'removed',
  uses,
});

export const reachesRegion = () => within(inspector()).queryByRole('region', { name: /^Reaches/ });

export const withChangesUnderApplication = {
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

export const panelWidth = () =>
  screen.getByRole('separator', { name: 'Panel width' }).getAttribute('aria-valuenow');

export const churned = (churn: number) => ({ head: { churn, fanIn: 0, fanOut: 0 } });

export const eightCrates = {
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

export const scaleSteps = () =>
  within(screen.getByRole('list', { name: 'Scale' }))
    .getAllByRole('listitem')
    .map(step => step.textContent);

export const colourBy = (name: string) =>
  within(screen.getByRole('group', { name: 'Colour by' })).getByRole('button', { name });

export const complex = (highest: number) => measured({ cyclomatic: { highest, total: highest } });

export const topFile = (label: string, state: Diffed = 'unchanged') => ({
  id: `web/file/${label}`,
  kind: 'file' as const,
  label,
  parent: 'web',
  path: `web/src/${label}`,
  state,
});

export const symbolsOf = (
  node: string,
  symbols: ReadonlyArray<Omit<SymbolStatement, 'lines'> & Partial<Pick<SymbolStatement, 'lines'>>>,
): SymbolFile => ({
  node,
  stack: 'web',
  symbols: symbols.map(symbol => ({ lines: {}, ...symbol })),
  exports: { added: [], removed: [] },
  kind: 'logic',
});

export const closeAndReopen = async (user: ReturnType<typeof userEvent.setup>, part: string) => {
  await user.click(within(inspector()).getByRole('button', { name: 'Close inspector' }));
  await user.click(screen.getByRole('button', { name: part }));
};

export const symbolGroups = () =>
  within(screen.getByRole('region', { name: 'What changed' }))
    .getAllByRole('list')
    .filter(list => !list.getAttribute('aria-label')?.startsWith('Signature of'))
    .map(list => [
      list.getAttribute('aria-label'),
      within(list)
        .getAllByRole('listitem')
        .filter(item => item.parentElement === list)
        .map(item => item.getAttribute('aria-label')),
    ]);

export const signatureLinesOf = async (signature: {
  readonly base: string;
  readonly head: string;
}) => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        range: 'abc123..def456',
        diff: {
          nodes: [
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
            topFile('reader.ts', 'modified'),
          ],
          edges: [],
        },
        symbols: [
          symbolsOf('web/file/reader.ts', [
            {
              name: 'Reader',
              kind: 'type',
              exported: { base: true, head: true },
              change: 'edited',
              signature,
            },
          ]),
        ],
      })}
    />,
  );
  await user.click(await screen.findByRole('button', { name: 'reader.ts: modified' }));
  return within(screen.getByRole('list', { name: 'Signature of type Reader' }))
    .getAllByRole('listitem')
    .map(line => line.textContent);
};

export const twoFunctionsPatch = () =>
  patchOf(
    'web/src/two.ts',
    '@@ -1,6 +1,6 @@',
    ' function a() {',
    '-  return 1;',
    '+  return 2;',
    ' }',
    ' function b() {',
    '-  return 3;',
    '+  return 4;',
    ' }',
  );

export const editedAt = (name: string, start: number, end: number) => ({
  name,
  kind: 'function' as const,
  exported: { base: false, head: false },
  change: 'edited' as const,
  lines: { base: { start, end }, head: { start, end } },
});

export const symbolDiffToggles = () =>
  within(whatChanged())
    .queryAllByRole('button', { name: /^Diff of/ })
    .map(toggle => [toggle.getAttribute('aria-label'), toggle.getAttribute('aria-expanded')]);

export const toggleSymbolDiff = (user: ReturnType<typeof userEvent.setup>, name: string) =>
  user.click(within(whatChanged()).getByRole('button', { name: `Diff of function ${name}` }));

export const symbolDiffRows = (role: 'insertion' | 'deletion') =>
  within(whatChanged())
    .queryAllByRole(role)
    .map(row => row.textContent);

export const whatChanged = () => screen.getByRole('region', { name: 'What changed' });

export const pageWithAnUnchangedSymbol = () =>
  pageWith({
    range: review.range,
    diff: {
      nodes: [
        { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
        topFile('tax.ts', 'modified'),
      ],
      edges: [],
    },
    symbols: [
      symbolsOf('web/file/tax.ts', [
        {
          name: 'tax',
          kind: 'function',
          exported: { base: false, head: false },
          change: 'edited',
          logic: [{ change: 'added', kind: 'guard', depth: 0, head: 'if (!rate) return', line: 2 }],
        },
        {
          name: 'round',
          kind: 'function',
          exported: { base: false, head: false },
          change: 'unchanged',
        },
      ]),
    ],
  });

export const unchangedSymbols = () =>
  within(whatChanged()).getByRole('group', { name: 'Unchanged symbols' });

export const draftOnTheUnchangedSymbol = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(within(whatChanged()).getByText('1 unchanged'));
  await user.click(
    within(whatChanged()).getByRole('button', { name: 'Comment on function round' }),
  );
  await write(
    user,
    within(whatChanged()).getByRole('textbox', { name: 'Your comment' }),
    'Why not?',
  );
};

export const roundNote = {
  version: 2,
  tests: '',
  summary: [],
  notes: {
    'symbol web/file/tax.ts#round': {
      text: 'Rounds half up.',
      recommendation: 'Round half to even.',
    },
  },
} as const;

export const roundRow = () =>
  within(whatChanged()).getByRole('listitem', { name: /^function round: unchanged/ });

export const pageWithSameNamedTests = () =>
  pageWith({
    range: review.range,
    diff: {
      nodes: [
        { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
        topFile('total.ts', 'modified'),
      ],
      edges: [],
    },
    tests: [
      {
        path: 'total.test.ts',
        stack: 'web',
        statements: [
          {
            kind: 'heading',
            name: 'Cart',
            children: [{ kind: 'test', name: 'adds tax', change: 'added' }],
          },
          {
            kind: 'heading',
            name: 'Till',
            children: [
              {
                kind: 'heading',
                name: 'at noon',
                children: [{ kind: 'test', name: 'adds tax', change: 'edited' }],
              },
            ],
          },
          { kind: 'test', name: 'drops totals', change: 'removed' },
        ],
      },
    ],
  });

export const pageWithPatch = (...hunkLines: ReadonlyArray<string>) =>
  pageWith({
    range: review.range,
    diff: {
      nodes: [
        { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
        topFile('x.ts', 'modified'),
      ],
      edges: [],
    },
    patches: [
      {
        path: 'web/src/x.ts',
        patch: ['--- a/web/src/x.ts', '+++ b/web/src/x.ts', ...hunkLines].join('\n'),
      },
    ],
  });

export const patchOf = (path: string, ...hunkLines: ReadonlyArray<string>) => ({
  path,
  patch: [`--- a/${path}`, `+++ b/${path}`, ...hunkLines].join('\n'),
});

export const diffTab = () => screen.getByRole('region', { name: 'Full diff' });

export const pageWithFilesDrawnOnlyAsABox = () =>
  pageWith({
    range: review.range,
    diff: {
      nodes: [
        { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
        webModule('billing', 'modified'),
      ],
      edges: [],
    },
    patches: [
      patchOf('web/src/billing/refund.ts', '@@ -8 +8 @@', '-const late = 1;', '+const late = 2;'),
      patchOf('web/src/billing/tax.ts', '@@ -3 +3 @@', '-const rate = 1;', '+const rate = 2;'),
    ],
  });

export const pageWithUndrawnFile = () =>
  pageWith({
    ...review,
    undrawn: [
      { path: 'README.md', patch: '--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-old\n+new' },
    ],
    findings: [
      {
        id: 'structure:undrawn',
        check: 'structure:undrawn',
        dimension: 'structure',
        level: 'info',
        title: '1 changed file outside the graph',
        detail: 'README.md',
      },
    ],
  });

export const openUndrawnFiles = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole('button', { name: 'Show 1 finding' }));
  await user.click(
    within(screen.getByRole('complementary', { name: 'Findings' })).getByRole('button', {
      name: 'README.md: 1 changed file outside the graph',
    }),
  );
};

export const pageWithLockfile = (place: 'undrawn' | 'patches', path: string) =>
  pageWith({
    ...review,
    [place]: [{ path, patch: `--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+new` }],
    findings: [
      {
        id: `dependencies:${path}:zod`,
        check: 'dependencies:direct',
        dimension: 'dependencies',
        level: 'look',
        file: path,
        title: 'zod 3.25.0 → 4.6.7',
        detail: path,
      },
      {
        id: `dependencies:not-read:${path}`,
        check: 'dependencies:not-read',
        dimension: 'dependencies',
        level: 'look',
        file: path,
        title: `${path} not read: Yarn 2+ format`,
      },
    ],
  });

export const at = (top: number, bottom: number): DOMRect => ({
  x: 0,
  y: top,
  top,
  bottom,
  left: 0,
  right: 0,
  width: 0,
  height: bottom - top,
  toJSON: () => ({}),
});

export const nothingChanged = {
  nodes: [],
  edges: [],
  symbols: [],
  decisions: [],
  tests: [],
  files: [],
};

export const changedSince = ({
  dropped,
  ...changed
}: Partial<Omit<ChangedSince, 'dropped'>> & {
  readonly dropped?: Partial<ChangedSince['dropped']>;
}): ChangedSince => ({
  ...nothingChanged,
  ...changed,
  dropped: { ...nothingChanged, ...dropped },
});

export const lastReview = { head: 'h1', verdict: 'comment' as const, comments: [], calledFine: [] };

export const sinceReview = {
  ...lastReview,
  changed: changedSince({ nodes: ['rust/crate/application'] }),
  changedWithoutComment: [],
  stillRead: [],
};

export const addedIfs = (name: string, count: number): Omit<SymbolStatement, 'lines'> => ({
  name,
  kind: 'function',
  exported: { base: false, head: false },
  change: 'edited',
  logic: Array.from({ length: count }, (_, index) => ({
    change: 'added',
    kind: 'if',
    depth: 0,
    head: `if (${name}${index})`,
    line: index + 1,
  })),
});

export const pageWithManyDecisions = () =>
  pageWith({
    range: 'abc123..def456',
    diff: {
      nodes: [
        { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
        topFile('many.ts', 'modified'),
      ],
      edges: [],
    },
    symbols: [symbolsOf('web/file/many.ts', [addedIfs('big', 5), addedIfs('small', 4)])],
  });

export const logicRowsOf = (name: string) =>
  within(whatChanged()).getByRole('group', { name: `Rows of function ${name}` });

export const unchangedIf = (test: string, line: number) =>
  ({ change: 'same', kind: 'if', depth: 0, head: `if (${test})`, line }) as const;

export const pageWithUnchangedRuns = () =>
  pageWith({
    range: 'abc123..def456',
    diff: {
      nodes: [
        { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
        topFile('runs.ts', 'modified'),
      ],
      edges: [],
    },
    symbols: [
      symbolsOf('web/file/runs.ts', [
        {
          name: 'runs',
          kind: 'function',
          exported: { base: false, head: false },
          change: 'edited',
          logic: [
            unchangedIf('a', 1),
            unchangedIf('b', 2),
            { change: 'added', kind: 'if', depth: 0, head: 'if (c)', line: 3 },
            unchangedIf('d', 4),
          ],
        },
      ]),
    ],
  });

export const unchangedRun = (count: number) =>
  within(whatChanged()).getByRole('group', { name: `${count} unchanged` });

export const pageWithSymbolsEditedThenAndSince = () =>
  pageWith({
    range: review.range,
    diff: {
      nodes: [
        { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
        topFile('tax.ts', 'modified'),
      ],
      edges: [],
    },
    symbols: [
      symbolsOf('web/file/tax.ts', [
        {
          name: 'tax',
          kind: 'function',
          exported: { base: false, head: false },
          change: 'edited',
          logic: [
            { change: 'added', kind: 'guard', depth: 0, head: 'if (!rate) return', line: 2 },
            { change: 'added', kind: 'if', depth: 0, head: 'if (rate > 1)', line: 3 },
          ],
        },
        {
          name: 'round',
          kind: 'function',
          exported: { base: false, head: false },
          change: 'edited',
        },
      ]),
    ],
    sinceReview: {
      ...sinceReview,
      changed: changedSince({
        symbols: ['web/file/tax.ts#tax'],
        decisions: ['web/file/tax.ts#tax#if (!rate) return'],
      }),
    },
  });

export const lastReviewSection = () => screen.getByRole('region', { name: 'Last review' });

export const saidOnPart = (
  id: string,
  said: Partial<Pick<Comment, 'kind' | 'text'>> & {
    readonly target?: string;
    readonly changedSince?: ReadonlyArray<Commit>;
  } = {},
): PreviousComment => ({
  anchor: { kind: 'part', id },
  kind: 'question',
  text: 'Why?',
  target: id,
  ...said,
});

export const pageWithAnAnsweredFinding = (
  since: Partial<Pick<SinceReview, 'calledFine' | 'comments'>>,
) => {
  const finding = (id: string, title: string): Finding => ({
    id,
    check: 'logic:changed',
    dimension: 'logic',
    level: 'look',
    target: 'rust/crate/application',
    title,
    detail: 'in tax',
  });
  return pageWith({
    ...review,
    findings: [finding('logic:a', 'lost a guard'), finding('logic:b', 'changed a branch')],
    sinceReview: { ...sinceReview, ...since },
  });
};

export const decisionIn = (name: string, head: string): SymbolStatement => ({
  name,
  kind: 'function',
  lines: {},
  exported: { base: false, head: false },
  change: 'edited',
  logic: [{ change: 'added', kind: 'if', depth: 0, head, line: 2 }],
});

export const pageOfLogic = () =>
  pageWith({
    range: 'abc123..def456',
    diff: {
      nodes: [
        { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
        topFile('refund.ts', 'modified'),
        topFile('cart.ts', 'modified'),
        topFile('styles.ts', 'modified'),
      ],
      edges: [
        webImport('refund.ts', 'cart.ts', 'unchanged'),
        webImport('refund.ts', 'styles.ts', 'added'),
      ],
    },
    symbols: [
      symbolsOf('web/file/refund.ts', [decisionIn('refund', 'if (late)')]),
      symbolsOf('web/file/cart.ts', [decisionIn('total', 'if (empty)')]),
      symbolsOf('web/file/styles.ts', []),
    ],
  });

export const refundPatch = {
  path: 'web/src/refund.ts',
  patch: ['@@ -1,2 +1,3 @@', ' function refund() {', '+  if (late) return;', ' }'].join('\n'),
};

export const logicCount = () =>
  within(screen.getByRole('region', { name: 'Start here' })).queryByRole('button', {
    name: /decisions? changed in/,
  });

export const pageOfOrders = (): PageData => {
  const line = { kind: 'if', depth: 0, line: 2 } as const;
  const logic: SymbolStatement['logic'] = [
    { ...line, change: 'added', head: 'if (late)' },
    { ...line, change: 'added', kind: 'throw', head: 'throw late' },
    { ...line, change: 'removed', kind: 'return', base: 'return early' },
  ];
  return {
    ...pageOfLogic(),
    diff: {
      nodes: [
        { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
        webModule('orders', 'modified'),
        webFile('orders', 'refund.ts', 'modified'),
        webFile('orders', 'cart.ts', 'modified'),
      ],
      edges: [],
    },
    symbols: [
      symbolsOf('web/file/orders/refund.ts', [{ ...decisionIn('refund', ''), logic }]),
      symbolsOf('web/file/orders/cart.ts', [decisionIn('total', 'if (empty)')]),
    ],
  };
};

export const decisionsIn = (file: string, count: number) =>
  symbolsOf(`web/file/${file}`, [addedIfs(file, count)]);

export const pageOfLogicToWalk = () => ({
  ...pageOfLogic(),
  readingOrder: { parts: ['web/file/cart.ts', 'web/file/refund.ts'], cycles: [] },
});

export const landedRow = (name: string) => within(whatChanged()).getByRole('listitem', { name });
