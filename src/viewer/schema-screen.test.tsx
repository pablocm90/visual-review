// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
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
