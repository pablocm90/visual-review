import { expect, test } from 'vitest';
import { parseReview } from './review.ts';

const reviewWith = () => ({
  version: 1,
  comments: {
    'web/file/App.tsx': { text: 'Why does App fetch this itself?' },
    'web/file/App.tsx -> web/module/modules/AppInfo': { text: 'Keep this edge.' },
  },
});

test('a review sent from the page reads back as its comments, keyed by node or edge id', () => {
  expect(parseReview(JSON.stringify(reviewWith()))).toEqual(reviewWith());
});

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
    text: JSON.stringify({ ...reviewWith(), verdict: 'approve' }),
    reason: '"verdict"',
  },
  {
    problem: 'has a key no comment has',
    text: JSON.stringify({
      version: 1,
      comments: { 'web/file/App.tsx': { text: 'Hm.', by: 'me' } },
    }),
    reason: '"by"',
  },
  {
    problem: 'has a comment with no text',
    text: JSON.stringify({ version: 1, comments: { 'web/file/App.tsx': {} } }),
    reason: 'text',
  },
])('a review that $problem is rejected saying why', ({ text, reason }) => {
  expect(() => parseReview(text)).toThrow(new RegExp(`^Invalid review: .*${reason}`, 's'));
});
