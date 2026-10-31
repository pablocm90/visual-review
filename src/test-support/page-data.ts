import type { NodeMeasures } from '../core/metrics.ts';
import type { PageData } from '../core/page.ts';

export const pageWith = (data: Pick<PageData, 'range' | 'diff'> & Partial<PageData>): PageData => ({
  repo: 'acme/shop',
  version: '0.1.0',
  metrics: {},
  metricFindings: [],
  dangling: [],
  patches: [],
  undrawn: [],
  tests: [],
  skipped: [],
  thresholds: { cyclomatic: 10, hotspot: { churn: 6, cyclomatic: 8 } },
  churnDays: 90,
  ...data,
});

export const measured = (overrides: Partial<NodeMeasures> = {}): NodeMeasures => ({
  churn: 6,
  fanIn: 1,
  fanOut: 3,
  lines: 120,
  functions: 6,
  cyclomatic: { highest: 4, total: 19 },
  abc: 18.24,
  ...overrides,
});
