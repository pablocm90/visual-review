// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { expect, onTestFinished, test, vi } from 'vitest';
import type { PageData } from '../core/page.ts';
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
