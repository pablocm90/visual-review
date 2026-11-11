// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import type { GraphDiff } from '../core/diff-graphs.ts';
import type { KindOfChange } from '../core/symbol-changes.ts';
import { findingOn, measured, pageWith } from '../test-support/page-data.ts';
import {
  allEdges,
  atHash,
  buttonsIn,
  changedSince,
  churned,
  colourBy,
  complex,
  crate,
  currentTab,
  dependency,
  eightCrates,
  findingsOnFiles,
  findingsShown,
  fold,
  fullDiffOpen,
  inspector,
  metricCells,
  metricMarks,
  noteLines,
  noteShown,
  openFold,
  openInformation,
  openReview,
  openView,
  pageWithLockfile,
  pageWithQuietTests,
  panelWidth,
  partComment,
  reachesRegion,
  reachOf,
  review,
  scaleSteps,
  scrolledIntoView,
  sentReview,
  showEverything,
  shown,
  sinceReview,
  symbolsOf,
  take,
  testedBy,
  testedByRows,
  topFile,
  webFile,
  webFilesReview,
  webImport,
  webModule,
  withChangesUnderApplication,
  write,
} from './review-page.fixtures.tsx';
import { ReviewPage } from './review-page.tsx';

afterEach(() => history.replaceState(null, '', location.pathname));

test("Start here's lines name their lens and dimension, and the findings an opened line lists don't", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        ...webFilesReview(2),
        findings: [
          ...findingsOnFiles(
            { count: 2, files: 2 },
            { check: 'api:signature', dimension: 'api', level: 'look' },
          ),
          findingOn('web/file/utils/0.ts', {
            check: 'flag',
            id: 'flagged',
            dimension: 'blast-radius',
            title: 'reaches far',
          }),
        ],
      })}
    />,
  );

  const band = within(await screen.findByRole('region', { name: 'Start here' }));
  await openInformation(user);
  const lineOf = (name: RegExp) => band.getByRole('button', { name }).closest('li');
  expect(lineOf(/exported signatures changed/)?.textContent).toContain('Contract · api');
  expect(lineOf(/reaches far/)?.textContent).toContain('Contract · blast radius');

  await user.click(band.getByRole('button', { name: /exported signatures changed/ }));
  expect(band.getByRole('button', { name: /said 0/ })).toBeDefined();
  expect(band.getAllByText('Contract · api')).toHaveLength(1);
});

test("an opened Start here line's finding on a file opens that file's patch", async () => {
  const user = userEvent.setup();
  const page = pageWithLockfile('undrawn', 'pnpm-lock.yaml');
  const direct = (name: string) => ({
    id: `dependencies:pnpm-lock.yaml:${name}`,
    check: 'dependencies:direct' as const,
    dimension: 'dependencies' as const,
    level: 'look' as const,
    file: 'pnpm-lock.yaml',
    title: `${name} 1.0.0 → 2.0.0`,
    detail: 'pnpm-lock.yaml',
  });
  render(<ReviewPage review={{ ...page, findings: [direct('vite'), direct('zod')] }} />);

  const band = within(await screen.findByRole('region', { name: 'Start here' }));
  await user.click(band.getByRole('button', { name: '2 direct dependencies changed · 1 file' }));
  await user.click(band.getByRole('button', { name: 'pnpm-lock.yaml: zod 1.0.0 → 2.0.0' }));

  expect(within(inspector()).getByRole('heading', { level: 2 }).textContent).toBe(
    'Changed files outside the graph',
  );
  expect(
    within(inspector()).getByRole('group', { name: 'pnpm-lock.yaml' }).hasAttribute('open'),
  ).toBe(true);
});

test('signatures called fine at the last review leave the Start here line counted without them, and the rail lists them all, tagged', async () => {
  const user = userEvent.setup();
  const findings = findingsOnFiles(
    { count: 7, files: 4 },
    { check: 'api:signature', dimension: 'api', level: 'look' },
  );
  render(
    <ReviewPage
      review={pageWith({
        ...webFilesReview(4),
        findings,
        sinceReview: {
          ...sinceReview,
          calledFine: ['api:signature:0', 'api:signature:1', 'api:signature:2'],
        },
      })}
    />,
  );

  const band = within(await screen.findByRole('region', { name: 'Start here' }));
  expect(
    band.getByRole('button', { name: '4 exported signatures changed · 4 files' }),
  ).toBeDefined();
  await user.click(screen.getByRole('button', { name: 'Show 7 findings' }));
  const rail = within(screen.getByRole('region', { name: 'API' }));
  expect(rail.getAllByRole('button', { name: /said \d$/ })).toHaveLength(4);
  expect(rail.getAllByRole('button', { name: /said \d, called fine$/ })).toHaveLength(3);
  expect(rail.getAllByText('called fine')).toHaveLength(3);
});

test('a suggested split in Start here opens the rail, where its group buttons are', async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        findings: [
          {
            id: 'cohesion:split',
            check: 'cohesion:split',
            dimension: 'cohesion',
            level: 'info',
            title: 'may be 2 independent changes',
            detail: 'read from the edges between parts',
            groups: [['rust/crate/domain'], ['rust/crate/application']],
          },
        ],
      })}
    />,
  );

  const band = within(await screen.findByRole('region', { name: 'Start here' }));
  await openInformation(user);
  const groupButton = { name: /^1 part, from/ };
  expect(band.queryByRole('button', groupButton)).toBeNull();
  expect(screen.queryByRole('complementary', { name: 'Findings' })).toBeNull();

  await user.click(band.getByRole('button', { name: 'may be 2 independent changes' }));

  const rail = within(screen.getByRole('complementary', { name: 'Findings' }));
  expect(rail.getAllByRole('button', groupButton)).toHaveLength(2);
});

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
        version: 2,
        tests: '',
        summary: [{ text: 'Check y.ts', target: 'web/file/utils/y.ts' }],
        notes: {
          'edge web/file/modules/AppInfo/api/app-info.ts -> web/file/utils/x.ts': {
            text: 'New helper.',
            flag: 'reaches into utils',
          },
          'part web/file/utils/y.ts': { text: 'Untouched, but read it.' },
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
  expect(buttonsIn(await screen.findByRole('group', { name: 'rust' }))).toEqual([
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
  await waitFor(() =>
    expect(within(web).queryByRole('group', { name: 'modules/AppInfo' })).toBeNull(),
  );
  await user.click(within(web).getByRole('button', { name: 'Collapse utils' }));
  await waitFor(() => expect(within(web).queryByRole('group', { name: 'utils' })).toBeNull());
  await user.click(screen.getByRole('button', { name: /^Show \d+ findings?$/ }));
  await user.click(
    within(screen.getByRole('complementary', { name: 'Findings' })).getByRole('button', {
      name: /: reaches into utils$/,
    }),
  );

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
        version: 2,
        tests: '',
        summary: [
          {
            text: 'See checkout.',
            target: 'web/file/orders/checkout.ts -> web/file/billing/invoice.ts',
          },
        ],
        notes: {
          'edge web/file/orders/cart.ts -> web/file/billing/invoice.ts': { text: 'Totals.' },
        },
      }}
    />,
  );
  await showEverything(user);
  const web = await screen.findByRole('group', { name: 'web' });
  const all = await allEdges(user);
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

test('a served page offers no comment and no Take on an edge drawn between closed modules, which stands for imports and is none of them, and says to open its ends', async () => {
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
            webFile('billing', 'invoice.ts'),
          ],
          edges: [webImport('orders/cart.ts', 'billing/invoice.ts', 'unchanged')],
        },
      })}
      notes={{
        version: 2,
        tests: '',
        summary: [],
        notes: {
          'edge web/file/orders/cart.ts -> web/file/billing/invoice.ts': {
            text: 'Bills the cart.',
            recommendation: 'Bill through the use case.',
          },
        },
      }}
      send={async () => {}}
    />,
  );
  await showEverything(user);
  const web = await screen.findByRole('group', { name: 'web' });
  const comment = () => within(inspector()).queryByRole('textbox', { name: 'Your comment' });

  await user.click(within(web).getByRole('button', { name: 'orders: unchanged' }));
  await partComment(user);
  expect(comment()).not.toBeNull();
  await user.click(within(web).getByRole('button', { name: 'orders → billing: unchanged' }));

  expect(comment()).toBeNull();
  expect(within(inspector()).getByText(/open its ends/)).not.toBeNull();
  expect(noteLines()).toContain('Recommendation Bill through the use case.');
  expect(take()).toBeNull();
});

test("with 'Changed + 1 hop' shown, going to a merged module edge or to a hidden import near a change keeps it shown", async () => {
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
        version: 2,
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
  await user.click(shown('Changed + 1 hop'));

  await user.click(screen.getByRole('button', { name: 'See the coupling.' }));

  expect(shown('Changed + 1 hop').getAttribute('aria-pressed')).toBe('true');

  await user.click(screen.getByRole('button', { name: 'See checkout.' }));

  expect(await allEdges(user)).toHaveProperty('checked', true);
  expect(shown('Changed + 1 hop').getAttribute('aria-pressed')).toBe('true');
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
        findings: [
          findingOn('web/file/modules/AppInfo/api/users.ts', {
            id: 'routes:dangling:web/file/modules/AppInfo/api/users.ts',
            dimension: 'routes',
            title: '1 call with no route',
            detail: '/api/app-info',
          }),
        ],
      })}
      notes={{
        version: 2,
        tests: '',
        summary: [],
        notes: {
          'edge web/file/modules/AppInfo/api/users.ts -> rust/crate/http-adapter': {
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
  await user.click(
    screen.getByRole('img', {
      name: 'for information, 1 finding: 1 call with no route: /api/app-info',
    }),
  );
  expect(findingsShown()).toEqual(['1 call with no route: /api/app-info']);
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

test("a measured node's Metrics fold gives each measure before and after with the difference, a missing side and its difference as —, and a side without complexity as not measured, and a box's values as the highest inside it, with no functions listed without their cyclomatic; a node or an edge without metrics has no Metrics fold", async () => {
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
  expect(within(inspector()).queryByRole('rowheader', { name: /^Lines/ })).toBeNull();
  await openFold(user, 'Metrics');
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
  await user.click(within(inspector()).getByRole('button', { name: 'Metrics', expanded: true }));
  expect(within(inspector()).queryByRole('rowheader', { name: /^Lines/ })).toBeNull();

  await user.click(screen.getByRole('button', { name: 'domain: unchanged' }));
  expect(fold('Metrics')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'application → domain: unchanged' }));
  expect(fold('Metrics')).toBeNull();
});

test("a Metrics row is marked by the level of the node's finding on it, a hotspot marking Churn", async () => {
  const user = userEvent.setup();
  const application = 'rust/crate/application';
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        metrics: {
          'rust/crate/domain': { head: measured({ cyclomatic: { highest: 20, total: 20 } }) },
          [application]: {
            base: measured({ lines: 850, cyclomatic: { highest: 14, total: 30 }, abc: 31.5 }),
            head: measured({ lines: 900, cyclomatic: { highest: 14, total: 30 }, abc: 31.5 }),
          },
        },
        thresholds: {
          cyclomatic: 10,
          splitParts: 4,
          hotspot: { churn: 5, cyclomatic: 10 },
          lines: 800,
          abc: 30,
        },
      })}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'application: modified' }));
  await openFold(user, 'Metrics');
  expect(metricMarks('Cyclomatic, highest')).toEqual(['for information']);
  expect(metricMarks('ABC size')).toEqual(['for information']);
  expect(metricMarks('Churn')).toEqual(['for information']);
  expect(metricMarks('Lines')).toEqual(['needs a look']);
  expect(metricMarks('Functions')).toEqual([]);
});

test("a measured file's Metrics fold lists its functions by cyclomatic base → head, a repeated name paired n-th with n-th, marked added, removed or modified, the highest head first and removed ones last", async () => {
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
  await openFold(user, 'Metrics');
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

test("a selected node's Full diff lists the patches of the files under it from their first hunk, a module's closed and a file's open with its added and removed lines marked, and stays open from one selection to the next; a file without a patch or an edge has no Full diff and shows its Note", async () => {
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
  await showEverything(user);
  await user.click(within(web).getByRole('button', { name: 'utils: modified' }));
  expect(fold('Full diff')).not.toBeNull();
  expect(changes()).toBeNull();
  await openFold(user, 'Full diff');
  expect(fileShown().hasAttribute('open')).toBe(false);

  await user.click(within(web).getByRole('button', { name: 'Expand utils' }));
  const utils = await within(web).findByRole('group', { name: 'utils' });
  await user.click(within(utils).getByRole('button', { name: 'x.ts: modified' }));
  expect(fullDiffOpen()).toBe(true);
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
  expect(fold('Full diff')).toBeNull();
  expect(changes()).toBeNull();
  expect(noteShown()).toBe('No note');

  await user.click(within(utils).getByRole('button', { name: 'x.ts: modified' }));
  expect(changes()).not.toBeNull();
  await user.click(within(web).getByRole('button', { name: 'y.ts → x.ts: unchanged' }));
  expect(fold('Full diff')).toBeNull();
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
        findings: [
          {
            id: 'structure:undrawn',
            check: 'structure:undrawn',
            dimension: 'structure',
            level: 'info',
            title: '2 changed files outside the graph',
            detail: 'README.md, docs/a.md',
          },
        ],
      })}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'Show 1 finding' }));
  const outside = 'README.md, docs/a.md: 2 changed files outside the graph';
  await user.click(
    within(screen.getByRole('complementary', { name: 'Findings' })).getByRole('button', {
      name: outside,
    }),
  );
  expect(within(inspector()).getByRole('heading', { level: 2 }).textContent).toBe(
    'Changed files outside the graph',
  );
  expect(panelWidth()).toBe('600');
  const readme = within(inspector()).getByRole('group', { name: 'README.md' });
  expect(within(inspector()).getByRole('group', { name: 'docs/a.md' })).toBeDefined();
  expect(readme.hasAttribute('open')).toBe(false);
  await user.click(within(readme).getByText('README.md'));
  expect(within(readme).getByRole('insertion').textContent).toBe('+new');

  await user.click(await screen.findByRole('button', { name: 'domain: unchanged' }));
  expect(within(inspector()).getByRole('heading', { level: 2 }).textContent).toBe('domain');

  const opener = within(screen.getByRole('complementary', { name: 'Findings' })).getByRole(
    'button',
    { name: outside },
  );
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

test("Tested by lists the test files at or under the selected node, counting their changed tests in its heading, and isn't drawn where none changed", async () => {
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
          { path: 'crates/cli-adapter/tests/cli.rs', stack: 'rust', unreadable: 'Too big' },
        ],
      })}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'application: modified' }));
  expect(fold('Full diff')).toBeNull();
  expect(within(testedBy()).getByRole('heading', { name: 'Tested by 3' })).toBeTruthy();
  expect(within(testedBy()).queryByRole('list', { name: 'Findings' })).toBeNull();
  expect(
    within(testedBy())
      .getAllByRole('region')
      .map(file => file.getAttribute('aria-label')),
  ).toEqual(['crates/application/src/lib.rs', 'crates/application/tests/export.rs']);
  await user.click(screen.getByRole('button', { name: 'application → domain: unchanged' }));
  expect(screen.queryByRole('region', { name: 'Tested by' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'domain: unchanged' }));
  expect(screen.queryByRole('region', { name: 'Tested by' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'cli-adapter: added' }));
  expect(within(testedBy()).getByRole('heading', { name: 'Tested by' })).toBeTruthy();
});

test('Tested by lists only changed tests, under the headings that hold one, each keeping its own id, while the Tests screen lists them all', async () => {
  const user = userEvent.setup();
  const sent = vi.fn(async () => {});
  render(<ReviewPage review={pageWithQuietTests()} send={sent} />);

  await user.click(await screen.findByRole('button', { name: 'total.ts: modified' }));
  expect(testedByRows()).toEqual(['rounds: edited', 'Cart', 'adds tax: added']);
  expect(screen.queryByText('No note')).toBeNull();

  await user.click(within(testedBy()).getByRole('button', { name: 'Comment on rounds#2' }));
  await write(user, within(testedBy()).getByRole('textbox', { name: 'Your comment' }), 'Why?');
  await openReview(user);
  await user.click(screen.getByRole('button', { name: 'Send to Claude' }));
  expect(sent).toHaveBeenCalledExactlyOnceWith(
    sentReview({
      verdict: 'comment',
      comments: [
        { anchor: { kind: 'test', id: 'total.test.ts#rounds#2' }, kind: 'question', text: 'Why?' },
      ],
    }),
  );

  location.hash = '#tests';
  const testChanges = await screen.findByRole('region', { name: 'Test changes' });
  expect(within(testChanges).getByRole('listitem', { name: 'opens: unchanged' })).toBeTruthy();
  expect(within(testChanges).getByRole('listitem', { name: 'stays: unchanged' })).toBeTruthy();
});

test('an unchanged test with a draft from the Tests screen shows in Tested by, and going to the draft lands on its row', async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={pageWithQuietTests()} send={vi.fn(async () => {})} />);
  await screen.findByRole('button', { name: 'total.ts: modified' });
  location.hash = '#tests';
  const quiet = within(
    within(await screen.findByRole('region', { name: 'Test changes' })).getByRole('listitem', {
      name: 'stays: unchanged',
    }),
  );
  await user.click(quiet.getByRole('button', { name: 'Comment on stays' }));
  await write(user, quiet.getByRole('textbox', { name: 'Your comment' }), 'Still right?');
  await openReview(user);

  await user.click(screen.getByRole('button', { name: 'stays' }));

  const row = await within(await screen.findByRole('region', { name: 'Tested by' })).findByRole(
    'listitem',
    { name: 'stays: unchanged' },
  );
  await waitFor(() => expect(document.activeElement).toBe(row));
  expect(testedByRows()).toEqual(['shifts: edited', 'stays: unchanged']);
});

test('on a later round an unchanged test stays in Tested by when the last review said something on it or it changed since', async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={{
        ...pageWithQuietTests(),
        sinceReview: {
          ...sinceReview,
          changed: changedSince({ tests: ['total.test.ts#Cart › holds'] }),
          comments: [
            {
              anchor: { kind: 'test', id: 'total.test.ts#Till › opens' },
              kind: 'question',
              text: 'Does it?',
            },
          ],
        },
      }}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'total.ts: modified' }));

  expect(testedByRows()).toEqual([
    'rounds: edited',
    'Till',
    'opens: unchanged',
    'Cart',
    'holds: unchanged, changed since',
    'adds tax: added',
  ]);
});

test("logic changed with no test alongside shows its finding under Tested by, with its answers, and Why look doesn't repeat it, nor draws for it alone; going to it lands on its row there", async () => {
  const user = userEvent.setup();
  const untestedOn = (target: string) =>
    findingOn(target, {
      id: `tests:untested-logic:${target}`,
      check: 'tests:untested-logic',
      dimension: 'tests',
      level: 'look',
      title: 'logic changed with no test changed alongside',
    });
  render(
    <ReviewPage
      review={pageWith({
        range: review.range,
        diff: {
          nodes: [
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
            topFile('tax.ts', 'modified'),
            topFile('refund.ts', 'modified'),
          ],
          edges: [],
        },
        findings: [
          untestedOn('web/file/tax.ts'),
          untestedOn('web/file/refund.ts'),
          findingOn('web/file/refund.ts'),
        ],
      })}
      send={async () => {}}
    />,
  );
  const whyLook = () => within(inspector()).queryByRole('region', { name: 'Why look' });
  const untestedRow = () =>
    within(within(testedBy()).getByRole('list', { name: 'Findings' })).getByRole('listitem');

  await user.click(await screen.findByRole('button', { name: 'tax.ts: modified' }));
  expect(whyLook()).toBeNull();
  await user.click(within(untestedRow()).getByRole('button', { name: 'Fix this' }));
  expect(
    within(untestedRow()).getByRole('button', { name: 'Fix this' }).getAttribute('aria-pressed'),
  ).toBe('true');

  await user.click(screen.getByRole('button', { name: 'refund.ts: modified' }));
  expect(within(whyLook() ?? inspector()).getAllByRole('listitem')).toHaveLength(1);
  expect(within(whyLook() ?? inspector()).getByText('lines 900, over 800')).toBeDefined();

  await user.click(screen.getByRole('button', { name: 'Show 3 findings' }));
  await user.click(
    within(screen.getByRole('complementary', { name: 'Findings' })).getByRole('button', {
      name: /^tax.ts: logic changed/,
    }),
  );
  expect(untestedRow().getAttribute('aria-current')).toBe('true');
  expect(scrolledIntoView.mock.contexts).toContain(untestedRow());
});

test('Reaches lists where the selected part reaches, counting files once, and is not drawn on a part reaching nothing', async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        range: review.range,
        diff: {
          nodes: [
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
            topFile('tax.ts', 'modified'),
            topFile('refund.ts', 'modified'),
          ],
          edges: [],
        },
        reaches: [
          reachOf('web/file/tax.ts', 'foo', [
            { path: 'web/src/b.ts', line: 41, text: 'foo(raw);' },
            { path: 'web/src/c.ts', line: 12, text: 'rows.map(foo)' },
          ]),
          reachOf('web/file/tax.ts', 'bar', [{ path: 'web/src/b.ts', line: 7, text: 'bar();' }]),
        ],
      })}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'refund.ts: modified' }));
  expect(reachesRegion()).toBeNull();

  await user.click(screen.getByRole('button', { name: 'tax.ts: modified' }));
  const region = reachesRegion() ?? inspector();
  expect(within(region).getByRole('heading', { name: 'Reaches 2 unchanged files' })).toBeTruthy();
  expect(
    within(region)
      .getAllByRole('listitem')
      .map(row => row.textContent),
  ).toEqual(['web/src/b.ts:41foo(raw);', 'web/src/c.ts:12rows.map(foo)', 'web/src/b.ts:7bar();']);
});

test('a Reaches row goes to the file it names, widening Show, and a file the graph has no node for stays text', async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        range: review.range,
        diff: {
          nodes: [
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
            topFile('tax.ts', 'modified'),
            topFile('b.ts'),
          ],
          edges: [],
        },
        reaches: [
          reachOf('web/file/tax.ts', 'foo', [
            { path: 'web/src/b.ts', line: 41, text: 'foo(raw);' },
            { path: 'web/src/gone.ts', line: 3, text: 'foo();' },
          ]),
        ],
      })}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'tax.ts: modified' }));
  const region = reachesRegion() ?? inspector();
  expect(within(region).queryByRole('button', { name: /gone\.ts/ })).toBeNull();
  expect(within(region).getByText('web/src/gone.ts:3')).toBeTruthy();

  await user.click(within(region).getByRole('button', { name: /^web\/src\/b\.ts:41/ }));
  expect(await screen.findByRole('heading', { level: 2, name: 'b.ts' })).toBeTruthy();
});

test('a Reaches row marks a test file and says when a use could not be followed', async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        range: review.range,
        diff: {
          nodes: [
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
            topFile('tax.ts', 'modified'),
          ],
          edges: [],
        },
        reaches: [
          reachOf('web/file/tax.ts', 'foo', [
            { path: 'web/src/lazy.ts', line: 3, text: "import('./tax')", unfollowed: true },
            { path: 'web/src/plain.ts', line: 4, text: 'foo();' },
            { path: 'web/src/tax.test.ts', line: 8, text: 'foo();', test: true },
          ]),
        ],
      })}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'tax.ts: modified' }));
  const [lazy, plain, tested] = within(reachesRegion() ?? inspector())
    .getAllByRole('listitem')
    .map(row => within(row));
  expect(lazy?.getByText('may use it, not followed')).toBeTruthy();
  expect(plain?.queryByText('may use it, not followed')).toBeNull();
  expect(plain?.queryByText('test')).toBeNull();
  expect(tested?.getByText('test')).toBeTruthy();
});

test("a part's reach findings sit above their own rows in Reaches, with answers, and Why look doesn't repeat them; going to one lands on its row there", async () => {
  const user = userEvent.setup();
  const reaches = [
    reachOf('web/file/tax.ts', 'foo', [{ path: 'web/src/b.ts', line: 41, text: 'foo(raw);' }]),
    reachOf('web/file/tax.ts', 'bar', [{ path: 'web/src/c.ts', line: 7, text: 'bar();' }]),
  ];
  const reachFinding = (name: string) =>
    findingOn('web/file/tax.ts', {
      id: `blast-radius:reaches:web/file/tax.ts#${name}`,
      check: 'blast-radius:reaches',
      dimension: 'blast-radius',
      level: 'look',
      title: `function ${name} reaches 1 unchanged file`,
    });
  render(
    <ReviewPage
      review={pageWith({
        range: review.range,
        diff: {
          nodes: [
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
            topFile('tax.ts', 'modified'),
          ],
          edges: [],
        },
        reaches,
        findings: [reachFinding('foo'), reachFinding('bar'), findingOn('web/file/tax.ts')],
      })}
      send={async () => {}}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'tax.ts: modified' }));
  const region = () => reachesRegion() ?? inspector();
  expect(
    within(region())
      .getAllByRole('listitem')
      .map(row => row.textContent),
  ).toEqual([
    expect.stringContaining('function foo'),
    expect.stringContaining('web/src/b.ts:41'),
    expect.stringContaining('function bar'),
    expect.stringContaining('web/src/c.ts:7'),
  ]);
  const whyLook = within(inspector()).getByRole('region', { name: 'Why look' });
  expect(within(whyLook).getAllByRole('listitem')).toHaveLength(1);

  const barRow = () =>
    within(region())
      .getByText(/function bar/)
      .closest('li') ?? region();
  await user.click(within(barRow()).getByRole('button', { name: 'Fix this' }));
  expect(
    within(barRow()).getByRole('button', { name: 'Fix this' }).getAttribute('aria-pressed'),
  ).toBe('true');

  await user.click(screen.getByRole('button', { name: 'Show 3 findings' }));
  await user.click(
    within(screen.getByRole('complementary', { name: 'Findings' })).getByRole('button', {
      name: /^tax.ts: function bar/,
    }),
  );
  expect(barRow().getAttribute('aria-current')).toBe('true');
});

test("a box's Reaches lists those of the files inside it, with their finding only while the box holds it", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        range: review.range,
        diff: {
          nodes: [
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
            webModule('orders', 'modified'),
            webFile('orders', 'refund.ts', 'modified'),
            webModule('billing', 'modified'),
            webFile('billing', 'tax.ts', 'modified'),
          ],
          edges: [],
        },
        reaches: [
          reachOf('web/file/orders/refund.ts', 'foo', [
            { path: 'web/src/b.ts', line: 41, text: 'foo(raw);' },
          ]),
        ],
        findings: [
          findingOn('web/file/orders/refund.ts', {
            id: 'blast-radius:reaches:web/file/orders/refund.ts#foo',
            check: 'blast-radius:reaches',
            dimension: 'blast-radius',
            level: 'look',
            title: 'function foo reaches 1 unchanged file',
          }),
        ],
      })}
    />,
  );

  await user.click(await screen.findByRole('button', { name: /^billing: modified/ }));
  expect(reachesRegion()).toBeNull();

  await user.click(screen.getByRole('button', { name: /^orders: modified/ }));
  const region = () => reachesRegion() ?? inspector();
  expect(
    within(within(region()).getByRole('list', { name: 'Findings' })).getByText(/function foo/),
  ).toBeTruthy();
  expect(within(region()).getByText('web/src/b.ts:41')).toBeTruthy();

  await user.click(screen.getByRole('button', { name: 'Expand orders' }));
  expect(await screen.findByRole('button', { name: 'Collapse orders' })).toBeTruthy();
  expect(within(region()).queryByRole('list', { name: 'Findings' })).toBeNull();
  expect(within(region()).getByText('web/src/b.ts:41')).toBeTruthy();
  expect(within(inspector()).queryByText('No note')).toBeNull();
});

test("a node's Tested by also lists the test files named after a file inside it, wherever they sit in its stack", async () => {
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
  expect(
    within(testedBy())
      .getAllByRole('region')
      .map(file => file.getAttribute('aria-label')),
  ).toEqual(['web/tests/refund.test.ts']);
});

test("a node's Tested by counts a test moved between two of its files once", async () => {
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
  expect(within(testedBy()).getByRole('heading', { name: 'Tested by 2' })).toBeTruthy();
});

test("'Changes only' is shown first, hiding a neighbour joined by an unchanged edge; going to a drawn node keeps it, going to a neighbour widens to 'Changed + 1 hop', and going further to 'Everything'", async () => {
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
        version: 2,
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
  const pressed = () =>
    within(screen.getByRole('group', { name: 'Show' }))
      .getAllByRole('button', { pressed: true })
      .map(button => button.textContent);
  expect(pressed()).toEqual(['Changes only']);
  expect(buttonsIn(rust)).toEqual(['application: modified']);
  const summary = screen.getByRole('region', { name: 'Summary' });
  await user.click(within(summary).getByRole('button', { name: 'Read the use case.' }));
  expect(pressed()).toEqual(['Changes only']);

  await user.click(within(summary).getByRole('button', { name: 'See what it uses.' }));

  expect(pressed()).toEqual(['Changed + 1 hop']);
  await waitFor(() =>
    expect(buttonsIn(rust)).toEqual([
      'application → domain: unchanged',
      'domain: unchanged',
      'application: modified',
    ]),
  );

  await user.click(within(summary).getByRole('button', { name: 'Check the CLI.' }));

  expect(pressed()).toEqual(['Everything']);
  await waitFor(() =>
    expect(document.activeElement).toBe(
      within(rust).getByRole('button', { name: 'cli-adapter: unchanged' }),
    ),
  );
});

test("with 'Changes only' shown and nothing drawn changed, the graph gives way to a line saying so", async () => {
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

test('a selected node opens its panel beside a divider that gives its width: 360 for a note alone, 600 with changes; arrow keys move the divider, other keys leave it, and it stops at 280 and where the graph, right of the findings rail, would get narrower than 320; the width it sets holds for later selections and across tabs', async () => {
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

  await user.click(screen.getByRole('link', { name: 'Tests' }));
  await waitFor(() => expect(currentTab()).toBe('Tests'));
  await user.click(screen.getByRole('link', { name: 'Structure' }));
  await waitFor(() => expect(currentTab()).toBe('Structure'));
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
  await openView(user);
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

  await openView(user);
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

test('on Kind of change a changed file is named with the strongest kind of its symbol changes: API change, logic change or formatting only; a changed file with no symbols read as symbols not read, an unchanged one with nothing', async () => {
  const user = userEvent.setup();
  const kinded = (node: string, kind: KindOfChange) => ({ ...symbolsOf(node, []), kind });
  render(
    <ReviewPage
      review={pageWith({
        range: 'abc123..def456',
        diff: {
          nodes: [
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
            topFile('api.ts', 'modified'),
            topFile('logic.ts', 'modified'),
            topFile('format.ts', 'modified'),
            topFile('styles.css', 'modified'),
            topFile('same.ts'),
          ],
          edges: [webImport('api.ts', 'same.ts', 'unchanged')],
        },
        symbols: [
          kinded('web/file/api.ts', 'api'),
          kinded('web/file/logic.ts', 'logic'),
          kinded('web/file/format.ts', 'formatting'),
        ],
      })}
    />,
  );
  const web = await screen.findByRole('group', { name: 'web' });
  await showEverything(user);
  await within(web).findByRole('button', { name: 'same.ts: unchanged' });

  await openView(user);
  await user.click(colourBy('Kind of change'));
  expect(colourBy('Kind of change').getAttribute('aria-pressed')).toBe('true');
  expect(screen.queryByRole('list', { name: 'Legend' })).toBeNull();
  expect(scaleSteps()).toEqual([
    'API change',
    'logic change',
    'formatting only',
    'symbols not read',
  ]);
  expect(buttonsIn(web)).toEqual([
    'api.ts → same.ts: unchanged',
    'api.ts: modified, API change',
    'logic.ts: modified, logic change',
    'format.ts: modified, formatting only',
    'styles.css: modified, symbols not read',
    'same.ts: unchanged',
  ]);
});

test('on Kind of change a closed box is named with the strongest kind among the files inside it', async () => {
  const user = userEvent.setup();
  const kinded = (node: string, kind: KindOfChange) => ({ ...symbolsOf(node, []), kind });
  render(
    <ReviewPage
      review={pageWith({
        range: 'abc123..def456',
        diff: {
          nodes: [
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
            webModule('checkout', 'modified'),
            webFile('checkout', 'pay.ts', 'modified'),
            webFile('checkout', 'api.ts', 'modified'),
            webModule('cart', 'modified'),
            webFile('cart', 'total.ts', 'modified'),
            webFile('cart', 'line.ts', 'modified'),
          ],
          edges: [],
        },
        symbols: [
          kinded('web/file/checkout/pay.ts', 'logic'),
          kinded('web/file/checkout/api.ts', 'api'),
          kinded('web/file/cart/total.ts', 'formatting'),
          kinded('web/file/cart/line.ts', 'logic'),
        ],
      })}
    />,
  );
  const web = await screen.findByRole('group', { name: 'web' });

  await openView(user);
  await user.click(colourBy('Kind of change'));
  expect(buttonsIn(web)).toEqual([
    'checkout: modified, API change',
    'Expand checkout',
    'cart: modified, logic change',
    'Expand cart',
  ]);
});
