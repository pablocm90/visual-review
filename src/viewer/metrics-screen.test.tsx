// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, onTestFinished, test } from 'vitest';
import type { DiffedNode } from '../core/diff-graphs.ts';
import { metricFindings } from '../core/metric-findings.ts';
import type { NodeMetrics } from '../core/metrics.ts';
import type { PageData } from '../core/page.ts';
import { measured, pageWith } from '../test-support/page-data.ts';
import { ReviewPage } from './review-page.tsx';

const atMetrics = () => {
  history.replaceState(null, '', '#metrics');
  onTestFinished(() => history.replaceState(null, '', location.pathname));
};

const crate = (name: string, state: DiffedNode['state'], stack = 'api'): DiffedNode => ({
  id: `${stack}/crate/${name}`,
  kind: 'package',
  label: name,
  parent: stack,
  path: `crates/${name}`,
  state,
});

const cyclomatic = (functions: ReadonlyArray<readonly [string, number]>) => ({
  highest: Math.max(0, ...functions.map(([, value]) => value)),
  total: functions.reduce((sum, [, value]) => sum + value, 0),
  byFunction: functions.map(([name, value]) => ({ name, cyclomatic: value })),
});

const reviewOf = ({
  rows,
  thresholds = { cyclomatic: 10, hotspot: { churn: 6, cyclomatic: 8 } },
  churnDays = 90,
}: {
  readonly rows: ReadonlyArray<readonly [DiffedNode, NodeMetrics]>;
  readonly thresholds?: PageData['thresholds'];
  readonly churnDays?: number;
}): PageData => {
  const metrics = Object.fromEntries(rows.map(([node, metrics]) => [node.id, metrics]));
  return pageWith({
    range: 'abc123..def456',
    diff: {
      nodes: [
        ...[...new Set(rows.map(([node]) => node.parent ?? ''))].map(
          (stack): DiffedNode => ({
            id: stack,
            kind: 'stack',
            label: stack,
            path: '',
            state: 'modified',
          }),
        ),
        ...rows.map(([node]) => node),
      ],
      edges: [],
    },
    metrics,
    metricFindings: metricFindings({ metrics, thresholds }),
    thresholds,
    churnDays,
  });
};

const tile = (name: string | RegExp) =>
  within(within(screen.getByRole('region', { name: 'Totals' })).getByRole('group', { name }))
    .getAllByRole('paragraph')
    .map(paragraph => paragraph.textContent);

test("the totals give the changed leaves' lines head − base, their functions over the cyclomatic threshold base → head with the head's highest, and the hotspots touched among the head's, under the page's thresholds and churn window", () => {
  atMetrics();
  const { rerender } = render(
    <ReviewPage
      review={reviewOf({
        thresholds: { cyclomatic: 12, hotspot: { churn: 6, cyclomatic: 8 } },
        churnDays: 30,
        rows: [
          [
            crate('refunds', 'modified'),
            {
              base: measured({ lines: 120, cyclomatic: cyclomatic([['refund_order', 4]]) }),
              head: measured({
                churn: 9,
                lines: 184,
                cyclomatic: cyclomatic([['refund_order', 14]]),
              }),
            },
          ],
          [crate('ledger', 'added'), { head: measured({ lines: 96, churn: 1 }) }],
          [crate('retry', 'removed'), { base: measured({ lines: 88 }) }],
          [
            crate('domain', 'unchanged'),
            { base: measured(), head: measured({ churn: 7, cyclomatic: cyclomatic([['x', 9]]) }) },
          ],
        ],
      })}
    />,
  );

  expect(tile('Lines')).toEqual(['+72', 'across 3 changed nodes']);
  expect(tile('Functions over 12 cyclomatic')).toEqual(['0 → 1', 'refund_order at 14']);
  expect(tile('Hotspots touched')).toEqual(['1 of 2', '6+ commits in 30 days and 8+ cyclomatic']);

  rerender(
    <ReviewPage
      review={reviewOf({
        rows: [[crate('retry', 'removed'), { base: measured({ lines: 88 }) }]],
      })}
    />,
  );
  expect(tile('Lines')).toEqual(['−88', 'across 1 changed node']);
  expect(tile('Functions over 10 cyclomatic')).toEqual(['0 → 0']);
});

const shownNodes = () =>
  within(screen.getByRole('region', { name: 'Metrics per node' }))
    .getAllByRole('rowheader')
    .map(header => within(header).getByRole('button').textContent);

test('the table lists the changed measured leaves, every measured leaf while "Changed + 1 hop" is pressed', async () => {
  atMetrics();
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={reviewOf({
        rows: [
          [crate('refunds', 'modified'), { base: measured(), head: measured() }],
          [crate('domain', 'unchanged'), { base: measured(), head: measured() }],
          [crate('ledger', 'added'), { head: measured() }],
        ],
      })}
    />,
  );
  const changed = screen.getByRole('button', { name: 'Changed 2' });

  expect(changed.getAttribute('aria-pressed')).toBe('true');
  expect(shownNodes()).toEqual(['ledger', 'refunds']);

  await user.click(screen.getByRole('button', { name: 'Changed + 1 hop 3' }));
  expect(changed.getAttribute('aria-pressed')).toBe('false');
  expect(shownNodes()).toEqual(['ledger', 'refunds', 'domain']);

  await user.click(changed);
  expect(shownNodes()).toEqual(['ledger', 'refunds']);
});

test('the stack picker offers the stacks holding a shown row, keeps the rows of the one picked, and all of them once the picked one holds none', async () => {
  atMetrics();
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={reviewOf({
        rows: [
          [crate('refunds', 'modified'), { base: measured(), head: measured() }],
          [crate('cart', 'modified', 'web'), { base: measured(), head: measured() }],
          [crate('helpers', 'unchanged', 'web'), { base: measured(), head: measured() }],
          [crate('mailer', 'unchanged', 'jobs'), { base: measured(), head: measured() }],
        ],
      })}
    />,
  );
  const stack = screen.getByRole('combobox', { name: 'Stack' });
  const offered = () =>
    within(stack)
      .getAllByRole('option')
      .map(option => option.textContent);

  expect(offered()).toEqual(['All stacks', 'api', 'web']);

  await user.selectOptions(stack, 'web');
  expect(shownNodes()).toEqual(['cart']);

  await user.click(screen.getByRole('button', { name: 'Changed + 1 hop 4' }));
  expect(offered()).toEqual(['All stacks', 'api', 'web', 'jobs']);
  expect(shownNodes()).toEqual(['cart', 'helpers']);

  await user.selectOptions(stack, 'jobs');
  await user.click(screen.getByRole('button', { name: 'Changed 2' }));
  expect(stack).toHaveProperty('value', '');
  expect(shownNodes()).toEqual(['refunds', 'cart']);
});

test('the rows go by cyclomatic Δ, highest first, until another "Sort by" is picked', async () => {
  atMetrics();
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={reviewOf({
        rows: [
          [
            crate('stripe', 'modified'),
            {
              base: measured(),
              head: measured({ churn: 9, cyclomatic: cyclomatic([['pay', 5]]) }),
            },
          ],
          [
            crate('refunds', 'modified'),
            {
              base: measured(),
              head: measured({ churn: 1, cyclomatic: cyclomatic([['refund_order', 14]]) }),
            },
          ],
        ],
      })}
    />,
  );

  expect(shownNodes()).toEqual(['refunds', 'stripe']);

  await user.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'Churn');
  expect(shownNodes()).toEqual(['stripe', 'refunds']);
});

const cellsOf = (label: string) =>
  within(screen.getByRole('row', { name: new RegExp(label) }))
    .getAllByRole('cell')
    .map(cell => cell.textContent);

test('a row gives each metric base → head and its Δ: lines, highest cyclomatic, ABC, fan-out, fan-in and churn', () => {
  atMetrics();
  render(
    <ReviewPage
      review={reviewOf({
        rows: [
          [
            crate('refunds', 'modified'),
            {
              base: measured({ lines: 120, abc: 18.24, fanOut: 3, fanIn: 1, churn: 6 }),
              head: measured({
                lines: 184,
                cyclomatic: cyclomatic([['refund_order', 14]]),
                abc: 31.46,
                fanOut: 5,
                fanIn: 2,
                churn: 9,
              }),
            },
          ],
        ],
      })}
    />,
  );

  expect(cellsOf('refunds')).toEqual([
    '120 → 184+64',
    '4 → 14+10',
    '18.2 → 31.5+13.2',
    '3 → 5+2',
    '1 → 2+1',
    '6 → 9+3',
  ]);
});

test('an added row reads "new" under its head values, a removed one "gone" under its base values', () => {
  atMetrics();
  render(
    <ReviewPage
      review={reviewOf({
        rows: [
          [crate('ledger', 'added'), { head: measured({ lines: 96, churn: 2 }) }],
          [crate('retry', 'removed'), { base: measured({ lines: 88, churn: 7 }) }],
        ],
      })}
    />,
  );

  expect(cellsOf('ledger')).toEqual([
    '— → 96new',
    '— → 4new',
    '— → 18.2new',
    '— → 3new',
    '— → 1new',
    '— → 2new',
  ]);
  expect(cellsOf('retry')).toEqual([
    '88 → —gone',
    '4 → —gone',
    '18.2 → —gone',
    '3 → —gone',
    '1 → —gone',
    '7 → —gone',
  ]);
});

test('a side without complexity reads "—" in the complexity columns, with no Δ', () => {
  atMetrics();
  render(
    <ReviewPage
      review={reviewOf({
        rows: [
          [
            crate('refunds', 'modified'),
            { base: measured({ lines: 120 }), head: { churn: 9, fanIn: 1, fanOut: 3 } },
          ],
          [
            crate('cart', 'modified'),
            { base: { churn: 2, fanIn: 1, fanOut: 3 }, head: measured() },
          ],
          [crate('schema', 'added'), { head: { churn: 1, fanIn: 2, fanOut: 0 } }],
        ],
      })}
    />,
  );

  expect(cellsOf('refunds').slice(0, 3)).toEqual(['120 → —', '4 → —', '18.2 → —']);
  expect(cellsOf('cart').slice(0, 3)).toEqual(['— → 120', '— → 4', '— → 18.2']);
  expect(cellsOf('schema').slice(0, 3)).toEqual(['— → —new', '— → —new', '— → —new']);
});

test("a row's mark names its node's change, and an unchanged row has none", async () => {
  atMetrics();
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={reviewOf({
        rows: [
          [crate('ledger', 'added'), { head: measured() }],
          [crate('refunds', 'modified'), { base: measured(), head: measured() }],
          [crate('retry', 'removed'), { base: measured() }],
          [crate('domain', 'unchanged'), { base: measured(), head: measured() }],
        ],
      })}
    />,
  );
  await user.click(screen.getByRole('button', { name: /^Changed \+ 1 hop/ }));
  const markOf = (label: string) =>
    within(screen.getByRole('row', { name: new RegExp(label) }))
      .queryByRole('img')
      ?.getAttribute('aria-label');

  expect(markOf('ledger')).toBe('added');
  expect(markOf('refunds')).toBe('modified');
  expect(markOf('retry')).toBe('removed');
  expect(markOf('domain')).toBeUndefined();
});

test("a cell carries the level mark of its node's finding on that metric, the hotspot one on Churn", () => {
  atMetrics();
  render(
    <ReviewPage
      review={reviewOf({
        thresholds: { cyclomatic: 10, lines: 150, abc: 20, hotspot: { churn: 6, cyclomatic: 8 } },
        rows: [
          [
            crate('refunds', 'modified'),
            {
              base: measured({
                lines: 120,
                abc: 18.24,
                churn: 6,
                cyclomatic: cyclomatic([['a', 12]]),
              }),
              head: measured({
                lines: 184,
                abc: 31.46,
                churn: 9,
                cyclomatic: cyclomatic([['a', 12]]),
              }),
            },
          ],
          [
            crate('cart', 'modified'),
            {
              base: measured({ churn: 1, cyclomatic: cyclomatic([['b', 9]]) }),
              head: measured({ churn: 7, abc: 25, cyclomatic: cyclomatic([['b', 9]]) }),
            },
          ],
        ],
      })}
    />,
  );
  const marksOf = (label: string) =>
    within(screen.getByRole('row', { name: new RegExp(label) }))
      .getAllByRole('cell')
      .map(cell => within(cell).queryByRole('img')?.getAttribute('aria-label'));

  expect(marksOf('refunds')).toEqual([
    'needs a look',
    'for information',
    'needs a look',
    undefined,
    undefined,
    'for information',
  ]);
  expect(marksOf('cart')).toEqual([
    undefined,
    undefined,
    'needs a look',
    undefined,
    undefined,
    'needs a look',
  ]);
});

test('with no measured node, "No node measured." stands in for the table', () => {
  atMetrics();
  render(<ReviewPage review={reviewOf({ rows: [] })} />);

  expect(screen.getByText('No node measured.')).toBeTruthy();
  expect(screen.queryByRole('table')).toBeNull();
});

test("the hotspot chart names each changed leaf's move, base to head, and an added one's head alone", () => {
  atMetrics();
  render(
    <ReviewPage
      review={reviewOf({
        rows: [
          [
            crate('refunds', 'modified'),
            {
              base: measured({ churn: 6, cyclomatic: cyclomatic([['a', 4]]) }),
              head: measured({ churn: 9, cyclomatic: cyclomatic([['a', 14]]) }),
            },
          ],
          [
            crate('ledger', 'added'),
            { head: measured({ churn: 1, cyclomatic: cyclomatic([['b', 3]]) }) },
          ],
        ],
      })}
    />,
  );

  expect(
    within(screen.getByRole('group', { name: 'Hotspots' }))
      .getAllByRole('img')
      .map(point => point.getAttribute('aria-label')),
  ).toEqual(['refunds: 6 → 9 commits, cyclomatic 4 → 14', 'ledger: new, 1 commit, cyclomatic 3']);
});
