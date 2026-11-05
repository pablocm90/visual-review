import { expect, test } from 'vitest';
import { type CoverageFacts, coverageOf } from './coverage.ts';
import type { Dimension } from './findings.ts';

const facts = (overrides: Partial<CoverageFacts> = {}): CoverageFacts => ({
  skipped: [],
  symbolsNotRead: [],
  symbols: [],
  tests: [],
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

test.for(['logic', 'api', 'tests'] as const)(
  '%s names a file whose symbols are unreadable',
  dimension => {
    const symbols = [{ stack: 'web', node: 'web/src/broken.ts', unreadable: 'SyntaxError' }];

    expect(notReadIn(dimension, { symbols })).toEqual(['not read for web/src/broken.ts']);
  },
);

test('only tests names a test file it could not read', () => {
  const tests = [{ path: 'web/src/broken.test.ts', stack: 'web', unreadable: 'SyntaxError' }];

  expect(notReadIn('tests', { tests })).toEqual(['not read for web/src/broken.test.ts']);
  expect(notReadIn('logic', { tests })).toEqual([]);
  expect(notReadIn('api', { tests })).toEqual([]);
});
