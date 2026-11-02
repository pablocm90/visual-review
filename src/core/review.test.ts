import { expect, test } from 'vitest';
import { parseReview } from './review.ts';

const reviewWith = (verdict = 'request-changes') => ({
  version: 1,
  verdict,
  comments: {
    'web/file/App.tsx': { text: 'Why does App fetch this itself?' },
    'web/file/App.tsx -> web/module/modules/AppInfo': { text: 'Keep this edge.' },
  },
});

test.for(['approve', 'comment', 'request-changes'])(
  'a review sent with %s reads back as that verdict and its comments, keyed by node or edge id',
  verdict => {
    expect(parseReview(JSON.stringify(reviewWith(verdict)))).toEqual(reviewWith(verdict));
  },
);

test.for([
  { problem: 'is not JSON', text: '{ "version": 1,', reason: 'SyntaxError' },
  { problem: 'has no version', text: '{ "comments": {} }', reason: 'no "version"' },
  {
    problem: 'has a version this one does not read',
    text: '{ "version": 2, "comments": {} }',
    reason: 'version 2 is unknown',
  },
  {
    problem: 'has a key no review has',
    text: JSON.stringify({ ...reviewWith(), summary: 'Fine.' }),
    reason: '"summary"',
  },
  {
    problem: 'has no verdict',
    text: JSON.stringify({ version: 1, comments: {} }),
    reason: 'verdict',
  },
  {
    problem: 'has a verdict the page does not offer',
    text: JSON.stringify({ ...reviewWith(), verdict: 'reject' }),
    reason: 'verdict',
  },
  {
    problem: 'has a key no comment has',
    text: JSON.stringify({
      ...reviewWith(),
      comments: { 'web/file/App.tsx': { text: 'Hm.', by: 'me' } },
    }),
    reason: '"by"',
  },
  {
    problem: 'has a comment with no text',
    text: JSON.stringify({ ...reviewWith(), comments: { 'web/file/App.tsx': {} } }),
    reason: 'text',
  },
])('a review that $problem is rejected saying why', ({ text, reason }) => {
  expect(() => parseReview(text)).toThrow(new RegExp(`^Invalid review: .*${reason}`, 's'));
});
