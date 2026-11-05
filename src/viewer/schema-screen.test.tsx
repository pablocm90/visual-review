// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, onTestFinished, test, vi } from 'vitest';
import type { PageData } from '../core/page.ts';
import type { TableChange } from '../core/schema-diff.ts';
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

const reviewOf = (schemas: PageData['schemas']): PageData =>
  pageWith({
    range: 'abc123..def456',
    diff: { nodes: [], edges: [] },
    schemas,
  });

const column = (name: string, type: string, options = '') => ({ name, type, options });
const index = (name: string, columns: ReadonlyArray<string>, options = '') => ({
  name,
  columns,
  options,
});

const table = (overrides: Partial<TableChange> = {}): TableChange => ({
  name: 'users',
  state: 'changed',
  options: { base: '', head: '' },
  columns: [],
  indexes: [],
  ...overrides,
});

const cellsOf = (card: HTMLElement, name: string) =>
  within(within(card).getByRole('row', { name: new RegExp(`^\\S ${name}( |$)`) }))
    .getAllByRole('cell')
    .map(cell => cell.textContent);

const tabs = () => within(screen.getByRole('navigation', { name: 'Review' }));

test('the Schema tab shows only when the review holds a schema change, and a link to it falls back to Structure without one', async () => {
  atHash('#schema');
  render(<ReviewPage review={reviewOf([])} />);

  expect(
    (await tabs().findByRole('link', { name: 'Structure' })).getAttribute('aria-current'),
  ).toBe('page');
  expect(tabs().queryByRole('link', { name: 'Schema' })).toBeNull();
});

test("a schema that couldn't be read and one added whole each say so on the Schema tab", async () => {
  atHash('#schema');
  render(
    <ReviewPage
      review={reviewOf([
        { file: 'db/schema.rb', notRead: 'Ruby syntax error' },
        { file: 'db/queue_schema.rb', whole: 'added', tableCount: 3 },
      ])}
    />,
  );

  expect((await tabs().findByRole('link', { name: 'Schema' })).getAttribute('aria-current')).toBe(
    'page',
  );
  expect(
    within(screen.getByRole('region', { name: 'db/schema.rb' })).getByText(/not read/i).textContent,
  ).toContain('Ruby syntax error');
  expect(
    within(screen.getByRole('region', { name: 'db/queue_schema.rb' })).getByText(/added/)
      .textContent,
  ).toContain('3 tables');
});

test('a changed table is a card under its file: columns and indexes each with their change, before and after', async () => {
  atHash('#schema');
  render(
    <ReviewPage
      review={reviewOf([
        {
          file: 'db/schema.rb',
          tables: [
            table({
              options: { base: 'force: :cascade', head: 'force: :cascade, id: :uuid' },
              columns: [
                { state: 'added', head: column('age', 'integer') },
                { state: 'removed', base: column('nick', 'string') },
                {
                  state: 'changed',
                  base: column('email', 'string', 'limit: 10'),
                  head: column('email', 'text', 'null: false'),
                },
              ],
              indexes: [
                { state: 'added', head: index('by_age', ['age', 'id'], 'unique: true') },
                { state: 'removed', base: index('lower_nick', ['lower(nick)']) },
              ],
            }),
          ],
        },
      ])}
    />,
  );

  const file = await screen.findByRole('region', { name: 'db/schema.rb' });
  const card = within(file).getByRole('article', { name: 'users, changed' });
  expect(cellsOf(card, 'age')[0]).toBe('+');
  expect(cellsOf(card, 'age').slice(1)).toStrictEqual(['', 'integer']);
  expect(cellsOf(card, 'nick').slice(0, 3)).toStrictEqual(['−', 'string', '']);
  expect(cellsOf(card, 'email')).toStrictEqual(['~', 'string limit: 10', 'text null: false']);
  expect(cellsOf(card, 'by_age')).toStrictEqual(['+', '', 'age, id unique: true']);
  expect(cellsOf(card, 'lower_nick')).toStrictEqual(['−', 'lower(nick)', '']);
  expect(cellsOf(card, 'Table options')).toStrictEqual([
    '~',
    'force: :cascade',
    'force: :cascade, id: :uuid',
  ]);
});

test("an unchanged table's options take no row, and an added or removed table says so on its card", async () => {
  atHash('#schema');
  render(
    <ReviewPage
      review={reviewOf([
        {
          file: 'db/schema.rb',
          tables: [
            table({ columns: [{ state: 'added', head: column('age', 'integer') }] }),
            table({
              name: 'carts',
              state: 'added',
              options: { base: '', head: 'id: :uuid' },
            }),
            table({ name: 'orders', state: 'removed' }),
          ],
        },
      ])}
    />,
  );

  const users = await screen.findByRole('article', { name: 'users, changed' });
  expect(within(users).queryByRole('row', { name: /Table options/ })).toBeNull();
  const carts = screen.getByRole('article', { name: 'carts, added' });
  expect(cellsOf(carts, 'Table options')).toStrictEqual(['+', '', 'id: :uuid']);
  expect(screen.getByRole('article', { name: 'orders, removed' })).toBeTruthy();
});

const reviewWithFindings = (): PageData =>
  pageWith({
    ...reviewOf([
      {
        file: 'db/schema.rb',
        tables: [table({ columns: [{ state: 'added', head: column('age', 'integer') }] })],
      },
      {
        file: 'db/queue_schema.rb',
        tables: [table({ columns: [{ state: 'added', head: column('queue', 'string') }] })],
      },
      { file: 'db/cache_schema.rb', notRead: 'Ruby syntax error' },
    ]),
    findings: [
      {
        id: 'schema:db/queue_schema.rb:users',
        check: 'schema:table-changed',
        dimension: 'schema',
        level: 'info',
        file: 'db/queue_schema.rb',
        table: 'users',
        title: 'users: 1 column added',
        detail: 'db/queue_schema.rb',
      },
      {
        id: 'schema:not-read:db/cache_schema.rb',
        check: 'schema:not-read',
        dimension: 'schema',
        level: 'look',
        file: 'db/cache_schema.rb',
        title: 'db/cache_schema.rb not read: Ruby syntax error',
      },
    ],
  });

test('a table finding in the rail opens the Schema tab at its card, in its file, and one on a whole file from Look first at that file', async () => {
  atHash('#structure');
  const user = userEvent.setup();
  render(<ReviewPage review={reviewWithFindings()} />);

  await user.click(await screen.findByRole('button', { name: 'Show 2 findings' }));
  await user.click(
    within(screen.getByRole('complementary', { name: 'Findings' })).getByRole('button', {
      name: 'db/queue_schema.rb: users: 1 column added',
    }),
  );

  await waitFor(() =>
    expect(document.activeElement).toBe(
      within(screen.getByRole('region', { name: 'db/queue_schema.rb' })).getByRole('article', {
        name: 'users, changed',
      }),
    ),
  );

  await user.click(tabs().getByRole('link', { name: 'Structure' }));
  await user.click(
    within(await screen.findByRole('region', { name: 'Look first' })).getByRole('button', {
      name: 'db/cache_schema.rb not read: Ruby syntax error',
    }),
  );

  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('region', { name: 'db/cache_schema.rb' })),
  );
  expect(tabs().getByRole('link', { name: 'Schema' }).getAttribute('aria-current')).toBe('page');

  await user.click(tabs().getByRole('link', { name: 'Structure' }));
  const schemaTab = tabs().getByRole('link', { name: 'Schema' });
  await user.click(schemaTab);
  await screen.findByRole('region', { name: 'db/cache_schema.rb' });
  expect(document.activeElement).toBe(schemaTab);
});

test('an answer to a table finding goes from the tray to its card, from the Schema tab too', async () => {
  atHash('#structure');
  const user = userEvent.setup();
  render(<ReviewPage review={reviewWithFindings()} send={vi.fn(async () => {})} />);

  await user.click(await screen.findByRole('button', { name: 'Show 2 findings' }));
  const rail = screen.getByRole('complementary', { name: 'Findings' });
  const finding = within(rail).getByText('users: 1 column added').closest('li') ?? rail;
  await user.click(within(finding).getByRole('button', { name: 'Fix this' }));
  await user.click(tabs().getByRole('link', { name: 'Schema' }));
  await screen.findByRole('region', { name: 'db/schema.rb' });
  await user.click(screen.getByRole('button', { name: 'Review' }));
  await user.click(
    within(screen.getByRole('list', { name: 'Drafts' })).getByRole('button', {
      name: 'users: 1 column added',
    }),
  );

  expect(document.activeElement).toBe(
    within(screen.getByRole('region', { name: 'db/queue_schema.rb' })).getByRole('article', {
      name: 'users, changed',
    }),
  );
});

test("a migration's finding, of the same dimension, still opens its own patch on a review with a schema change", async () => {
  atHash('#structure');
  const user = userEvent.setup();
  const path = 'db/migrate/1_add_age.rb';
  render(
    <ReviewPage
      review={pageWith({
        ...reviewWithFindings(),
        undrawn: [{ path, patch: `--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+new` }],
        findings: [
          {
            id: `schema:${path}:1`,
            check: 'schema:migration-risk',
            dimension: 'schema',
            level: 'look',
            file: path,
            title: 'Adding a column with a default',
            detail: path,
          },
        ],
      })}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'Show 1 finding' }));
  await user.click(
    within(screen.getByRole('complementary', { name: 'Findings' })).getByRole('button', {
      name: `${path}: Adding a column with a default`,
    }),
  );

  expect(await screen.findByRole('group', { name: path })).toHaveProperty('open', true);
  expect(tabs().getByRole('link', { name: 'Structure' }).getAttribute('aria-current')).toBe('page');
});
