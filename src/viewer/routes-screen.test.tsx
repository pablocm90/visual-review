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
