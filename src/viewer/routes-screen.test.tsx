// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, onTestFinished, test, vi } from 'vitest';
import type { PageData } from '../core/page.ts';
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

test("route files that couldn't be read say so on the Routes tab", async () => {
  atHash('#routes');
  render(
    <ReviewPage review={reviewOf([{ file: 'config/routes.rb', notRead: 'Ruby syntax error' }])} />,
  );

  expect((await tabs().findByRole('link', { name: 'Routes' })).getAttribute('aria-current')).toBe(
    'page',
  );
  expect(
    within(screen.getByRole('region', { name: 'config/routes.rb' })).getByText(/not read/i)
      .textContent,
  ).toContain('Ruby syntax error');
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
});
