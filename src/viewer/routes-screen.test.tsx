// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, onTestFinished, test, vi } from 'vitest';
import type { PageData } from '../core/page.ts';
import type { UnreadRow } from '../core/read-routes.ts';
import { routeFindings } from '../core/route-findings.ts';
import type { Route } from '../core/routes.ts';
import { pageWith } from '../test-support/page-data.ts';
import { ReviewPage } from './review-page.tsx';

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: () => {} });

const atHash = (hash: string) => {
  history.replaceState(null, '', hash);
  onTestFinished(() => history.replaceState(null, '', location.pathname));
};

const reviewOf = (routes: PageData['routes']): PageData =>
  pageWith({
    range: 'abc123..def456',
    diff: { nodes: [], edges: [] },
    routes,
  });

const tabs = () => within(screen.getByRole('navigation', { name: 'Review' }));

test('the Routes tab shows only when the review holds a route change, and a link to it falls back to Structure without one', async () => {
  atHash('#routes');
  render(<ReviewPage review={reviewOf([])} />);

  expect(
    (await tabs().findByRole('link', { name: 'Structure' })).getAttribute('aria-current'),
  ).toBe('page');
  expect(tabs().queryByRole('link', { name: 'Routes' })).toBeNull();
});

test("route files that couldn't be read say so on the Routes tab, where their finding lands", async () => {
  atHash('#structure');
  const user = userEvent.setup();
  const routes: PageData['routes'] = [{ file: 'config/routes.rb', notRead: 'Ruby syntax error' }];
  render(
    <ReviewPage review={pageWith({ ...reviewOf(routes), findings: routeFindings(routes) })} />,
  );

  await user.click(
    within(await screen.findByRole('region', { name: 'Start here' })).getByRole('button', {
      name: /config\/routes\.rb not read/,
    }),
  );

  const file = await screen.findByRole('region', { name: 'config/routes.rb' });
  await waitFor(() => expect(document.activeElement).toBe(file));
  expect(within(file).getByText(/not read/i).textContent).toContain('Ruby syntax error');
  expect(tabs().getByRole('link', { name: 'Routes' }).getAttribute('aria-current')).toBe('page');
});

test("a route file's patch opens from its section, among the files outside the graph, at its top", async () => {
  atHash('#routes');
  const user = userEvent.setup();
  const routes: PageData['routes'] = [{ file: 'config/routes.rb', notRead: 'Ruby syntax error' }];
  render(
    <ReviewPage
      review={pageWith({
        ...reviewOf(routes),
        undrawn: [
          { path: 'README.md', patch: '' },
          { path: 'config/routes.rb', patch: '' },
        ],
      })}
    />,
  );

  await user.click(
    within(await screen.findByRole('region', { name: 'config/routes.rb' })).getByRole('button', {
      name: 'Show patch',
    }),
  );

  const inspector = await screen.findByRole('complementary', { name: 'Inspector' });
  expect(
    within(inspector).getByRole('group', { name: 'config/routes.rb' }).hasAttribute('open'),
  ).toBe(true);
  expect(within(inspector).getByRole('group', { name: 'README.md' }).hasAttribute('open')).toBe(
    false,
  );
  expect(tabs().getByRole('link', { name: 'Structure' }).getAttribute('aria-current')).toBe('page');
});

test("a route file's patch opens on the Diff tab of the node holding it", async () => {
  atHash('#routes');
  const user = userEvent.setup();
  const path = 'config/routes.rb';
  render(
    <ReviewPage
      review={pageWith({
        ...reviewOf([{ file: path, notRead: 'Ruby syntax error' }]),
        diff: {
          nodes: [
            { id: 'config', kind: 'module', label: 'config', path: 'config', state: 'modified' },
          ],
          edges: [],
        },
        patches: [{ path, patch: `--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+new` }],
      })}
    />,
  );

  await user.click(
    within(await screen.findByRole('region', { name: path })).getByRole('button', {
      name: 'Show patch',
    }),
  );

  const inspector = await screen.findByRole('complementary', { name: 'Inspector' });
  expect(within(inspector).getByRole('heading', { level: 2 }).textContent).toBe('config');
  expect(within(inspector).getByRole('tab', { name: 'Diff' }).getAttribute('aria-selected')).toBe(
    'true',
  );
  expect(within(inspector).getByRole('group', { name: path }).hasAttribute('open')).toBe(true);
  expect(tabs().getByRole('link', { name: 'Structure' }).getAttribute('aria-current')).toBe('page');
});

const route = (overrides: Partial<Route> = {}): Route => ({
  verb: 'GET',
  path: '/users',
  target: 'users#index',
  root: 'config/routes.rb',
  file: 'config/routes.rb',
  line: 1,
  ...overrides,
});

const cellsOf = (region: HTMLElement, name: string) =>
  within(within(region).getByRole('row', { name: new RegExp(`^\\S ${name} `) }))
    .getAllByRole('cell')
    .map(cell => cell.textContent);

test('changed routes are rows under the file behind them, each with its target before and after and where it is written', async () => {
  atHash('#routes');
  render(
    <ReviewPage
      review={reviewOf([
        {
          routes: [
            {
              state: 'added',
              patch: 'config/routes/admin.rb',
              head: route({
                path: '/admin',
                target: 'admin#index',
                file: 'config/routes/admin.rb',
                line: 4,
              }),
            },
            {
              state: 'changed',
              patch: 'config/routes.rb',
              base: route({ path: '/a', target: 'a#old', line: 2 }),
              head: route({ path: '/a', target: 'a#new', line: 3 }),
            },
            {
              state: 'removed',
              patch: 'config/routes.rb',
              base: route({ verb: 'DELETE', path: '/b', target: 'b#destroy', line: 7 }),
            },
          ],
          unread: [],
        },
      ])}
    />,
  );

  const main = await screen.findByRole('region', { name: 'config/routes.rb' });
  expect(cellsOf(main, 'GET /a')).toStrictEqual(['~', 'a#old', 'a#new', 'config/routes.rb:3']);
  expect(cellsOf(main, 'DELETE /b')).toStrictEqual(['−', 'b#destroy', '', 'config/routes.rb:7']);
  expect(
    cellsOf(screen.getByRole('region', { name: 'config/routes/admin.rb' }), 'GET /admin'),
  ).toStrictEqual(['+', '', 'admin#index', 'config/routes/admin.rb:4']);
});

test('in a file, what needs a look comes first, and PATCH and PUT of one path are one line', async () => {
  atHash('#routes');
  render(
    <ReviewPage
      review={reviewOf([
        {
          routes: [
            { state: 'added', patch: 'config/routes.rb', head: route({ path: '/new' }) },
            {
              state: 'added',
              patch: 'config/routes.rb',
              head: route({ verb: 'PATCH', path: '/both' }),
            },
            {
              state: 'added',
              patch: 'config/routes.rb',
              head: route({ verb: 'PUT', path: '/both' }),
            },
            {
              state: 'changed',
              patch: 'config/routes.rb',
              base: route({ path: '/moved', target: 'a#old' }),
              head: route({ path: '/moved', target: 'a#new' }),
            },
            { state: 'removed', patch: 'config/routes.rb', base: route({ path: '/gone' }) },
          ],
          unread: [],
        },
      ])}
    />,
  );

  const file = await screen.findByRole('region', { name: 'config/routes.rb' });
  expect(
    within(file)
      .getAllByRole('rowheader')
      .map(name => name.textContent),
  ).toStrictEqual(['GET /gone', 'GET /moved', 'GET /new', 'PATCH/PUT /both']);
});

test("statements not read are listed under the file behind them, each with its change, the scope around it and where it's written, in a file with no route change too", async () => {
  atHash('#routes');
  render(
    <ReviewPage
      review={reviewOf([
        {
          routes: [],
          unread: [
            {
              state: 'added',
              patch: 'config/routes.rb',
              item: {
                text: 'devise_for :users',
                path: '/admin',
                module: 'staff',
                root: 'config/routes.rb',
                file: 'config/routes/auth.rb',
                line: 9,
              },
            },
            {
              state: 'removed',
              patch: 'config/routes.rb',
              item: {
                text: 'concern :a',
                path: '',
                module: '',
                root: 'config/routes.rb',
                file: 'config/routes.rb',
                line: 3,
              },
            },
          ],
        },
      ])}
    />,
  );

  const file = await screen.findByRole('region', { name: 'config/routes.rb' });
  const [added, removed] = within(within(file).getByRole('list', { name: 'Not read' }))
    .getAllByRole('listitem')
    .map(item => item.textContent);
  expect(added).toContain('+');
  expect(added).toContain('devise_for :users');
  expect(added).toContain('under /admin');
  expect(added).toContain('staff');
  expect(added).toContain('config/routes/auth.rb:9');
  expect(removed).toContain('−');
  expect(removed).not.toContain('under');
  expect(within(file).queryByRole('table')).toBeNull();
});

const reviewWithFindings = (): PageData =>
  pageWith({
    ...reviewOf([
      {
        routes: [
          { state: 'added', patch: 'config/routes.rb', head: route({ path: '/new' }) },
          {
            state: 'added',
            patch: 'config/routes/admin.rb',
            head: route({ path: '/admin', file: 'config/routes/admin.rb' }),
          },
        ],
        unread: [],
      },
    ]),
    findings: [
      {
        id: 'routes:added:config/routes/admin.rb',
        check: 'routes:added',
        dimension: 'routes',
        level: 'info',
        file: 'config/routes/admin.rb',
        title: '1 route added in config/routes/admin.rb',
      },
    ],
  });

test("a route file's finding opens the Routes tab at its file, from the rail", async () => {
  atHash('#structure');
  const user = userEvent.setup();
  render(<ReviewPage review={reviewWithFindings()} />);

  await user.click(await screen.findByRole('button', { name: 'Show 1 finding' }));
  await user.click(
    within(screen.getByRole('complementary', { name: 'Findings' })).getByRole('button', {
      name: /1 route added in config\/routes\/admin\.rb/,
    }),
  );

  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole('region', { name: 'config/routes/admin.rb' }),
    ),
  );
  expect(tabs().getByRole('link', { name: 'Routes' }).getAttribute('aria-current')).toBe('page');

  await user.click(tabs().getByRole('link', { name: 'Structure' }));
  const routesTab = tabs().getByRole('link', { name: 'Routes' });
  await user.click(routesTab);
  await screen.findByRole('region', { name: 'config/routes/admin.rb' });
  expect(document.activeElement).toBe(routesTab);
});

test("a route's finding lands on its row, among rows of one line from two apps", async () => {
  atHash('#structure');
  const user = userEvent.setup();
  const routes: PageData['routes'] = [
    {
      routes: [
        {
          state: 'removed',
          patch: 'config/routes.rb',
          base: route({ path: '/gone', root: 'apps/a/', line: 2 }),
        },
        {
          state: 'removed',
          patch: 'config/routes.rb',
          base: route({ path: '/gone', root: 'apps/b/', line: 9 }),
        },
      ],
      unread: [],
    },
  ];
  render(
    <ReviewPage review={pageWith({ ...reviewOf(routes), findings: routeFindings(routes) })} />,
  );

  await user.click(await screen.findByRole('button', { name: 'Show 2 findings' }));
  await user.click(
    within(screen.getByRole('complementary', { name: 'Findings' })).getByRole('button', {
      name: /:9.*GET \/gone removed/,
    }),
  );

  const [, second] = within(
    await screen.findByRole('region', { name: 'config/routes.rb' }),
  ).getAllByRole('row', { name: /GET \/gone/ });
  await waitFor(() => expect(document.activeElement).toBe(second));
});

test("an answer to a route's finding goes from the tray to its row", async () => {
  atHash('#structure');
  const user = userEvent.setup();
  const routes: PageData['routes'] = [
    {
      routes: [{ state: 'removed', patch: 'config/routes.rb', base: route({ path: '/gone' }) }],
      unread: [],
    },
  ];
  render(
    <ReviewPage
      review={pageWith({ ...reviewOf(routes), findings: routeFindings(routes) })}
      send={vi.fn(async () => {})}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'Show 1 finding' }));
  const rail = screen.getByRole('complementary', { name: 'Findings' });
  const finding = within(rail).getByText('GET /gone removed').closest('li') ?? rail;
  await user.click(within(finding).getByRole('button', { name: 'Fix this' }));
  await user.click(screen.getByRole('button', { name: 'Review' }));
  await user.click(
    within(screen.getByRole('list', { name: 'Drafts' })).getByRole('button', {
      name: 'GET /gone removed',
    }),
  );

  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('row', { name: /GET \/gone/ })),
  );
});

test("a statement's finding lands on its line of the list, among one statement drawn twice", async () => {
  atHash('#structure');
  const user = userEvent.setup();
  const statement = (path: string): UnreadRow => ({
    state: 'added',
    patch: 'config/routes.rb',
    item: {
      text: 'devise_for :users',
      path,
      module: '',
      root: 'config/routes.rb',
      file: 'config/routes/auth.rb',
      line: 9,
    },
  });
  const routes: PageData['routes'] = [
    { routes: [], unread: [statement('/admin'), statement('/staff')] },
  ];
  render(
    <ReviewPage review={pageWith({ ...reviewOf(routes), findings: routeFindings(routes) })} />,
  );

  await user.click(await screen.findByRole('button', { name: 'Show 2 findings' }));
  const [, second] = within(screen.getByRole('complementary', { name: 'Findings' })).getAllByRole(
    'button',
    { name: /Added, not read: devise_for :users/ },
  );
  await user.click(second ?? document.body);

  const [, line] = within(await screen.findByRole('list', { name: 'Not read' })).getAllByRole(
    'listitem',
  );
  await waitFor(() => expect(document.activeElement).toBe(line));
  expect(line?.textContent).toContain('under /staff');
});
