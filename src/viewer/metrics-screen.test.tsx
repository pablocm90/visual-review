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
    .map(header => header.textContent);

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
  expect(shownNodes()).toEqual(['refundsapi', 'ledgerapi']);

  await user.click(screen.getByRole('button', { name: 'Changed + 1 hop 3' }));
  expect(changed.getAttribute('aria-pressed')).toBe('false');
  expect(shownNodes()).toEqual(['refundsapi', 'domainapi', 'ledgerapi']);

  await user.click(changed);
  expect(shownNodes()).toEqual(['refundsapi', 'ledgerapi']);
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
  expect(shownNodes()).toEqual(['cartweb']);

  await user.click(screen.getByRole('button', { name: 'Changed + 1 hop 4' }));
  expect(offered()).toEqual(['All stacks', 'api', 'web', 'jobs']);
  expect(shownNodes()).toEqual(['cartweb', 'helpersweb']);

  await user.selectOptions(stack, 'jobs');
  await user.click(screen.getByRole('button', { name: 'Changed 2' }));
  expect(stack).toHaveProperty('value', '');
  expect(shownNodes()).toEqual(['refundsapi', 'cartweb']);
});
