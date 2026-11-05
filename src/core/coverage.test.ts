import { expect, test } from 'vitest';
import { type CoverageFacts, coverageOf } from './coverage.ts';
import type { Dimension } from './findings.ts';

const facts = (overrides: Partial<CoverageFacts> = {}): CoverageFacts => ({
  skipped: [],
  symbolsNotRead: [],
  ...overrides,
});

const notReadIn = (dimension: Dimension, overrides: Partial<CoverageFacts>) =>
  coverageOf(facts(overrides)).find(entry => entry.dimension === dimension)?.notRead;

test('with nothing unread, each dimension a check raises is listed as checked, and no other', () => {
  expect(coverageOf(facts())).toEqual([
    { dimension: 'structure', notRead: [] },
    { dimension: 'logic', notRead: [] },
    { dimension: 'api', notRead: [] },
    { dimension: 'tests', notRead: [] },
    { dimension: 'cohesion', notRead: [] },
  ]);
});

test('structure names a skipped stack, and cohesion stays checked', () => {
  const skipped = [{ reader: 'rust' as const, tool: 'cargo', stacks: ['api', 'worker'] }];

  expect(notReadIn('structure', { skipped })).toEqual([
    'api, worker not read: cargo not found on PATH',
  ]);
  expect(notReadIn('cohesion', { skipped })).toEqual([]);
});

test.for(['logic', 'api', 'tests'] as const)(
  '%s names, once each, the skipped stacks and those whose reader reads no symbols',
  dimension => {
    const skipped = [{ reader: 'rust' as const, tool: 'cargo', stacks: ['api', 'worker'] }];

    expect(notReadIn(dimension, { skipped, symbolsNotRead: ['worker', 'web'] })).toEqual([
      'not read for api',
      'not read for worker',
      'not read for web',
    ]);
  },
);
