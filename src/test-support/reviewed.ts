import type { ReviewedHead } from '../core/reading.ts';

export const reviewedHead = (overrides: Partial<ReviewedHead> = {}): ReviewedHead => ({
  head: 'h1',
  verdict: 'comment',
  read: [],
  comments: [],
  calledFine: [],
  ...overrides,
});
