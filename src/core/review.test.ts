import { expect, test } from 'vitest';
import { parseReview } from './review.ts';

const reviewWith = (verdict = 'request-changes') => ({
  version: 2,
  verdict,
  comments: [
    {
      anchor: { kind: 'part', id: 'web/file/App.tsx' },
      kind: 'question',
      text: 'Why does App fetch this itself?',
    },
    {
      anchor: { kind: 'edge', id: 'web/file/App.tsx -> web/module/modules/AppInfo' },
      kind: 'change',
      text: 'Drop this edge.',
    },
    {
      anchor: { kind: 'part', id: 'web/module/modules/AppInfo' },
      kind: 'suggestion',
      text: 'Maybe split it.',
    },
  ],
});

const withComment = (comment: object) => ({ ...reviewWith(), comments: [comment] });

test.for(['approve', 'comment', 'request-changes'])(
  'a review sent with %s reads back as that verdict and its comments, each on its anchor with its kind',
  verdict => {
    expect(parseReview(JSON.stringify(reviewWith(verdict)))).toEqual(reviewWith(verdict));
  },
);

test.for([
  { problem: 'is not JSON', text: '{ "version": 2,', reason: 'SyntaxError' },
  { problem: 'has no version', text: '{ "comments": [] }', reason: 'no "version"' },
  {
    problem: 'has a version this one does not read',
    text: '{ "version": 1, "comments": {} }',
    reason: 'version 1 is unknown; this visual-review reads version 2',
  },
  {
    problem: 'has a key no review has',
    text: JSON.stringify({ ...reviewWith(), summary: 'Fine.' }),
    reason: '"summary"',
  },
  {
    problem: 'has no verdict',
    text: JSON.stringify({ version: 2, comments: [] }),
    reason: 'verdict',
  },
  {
    problem: 'has a verdict the page does not offer',
    text: JSON.stringify({ ...reviewWith(), verdict: 'reject' }),
    reason: 'verdict',
  },
  {
    problem: 'has a key no comment has',
    text: JSON.stringify(
      withComment({ anchor: { kind: 'part', id: 'a' }, kind: 'question', text: 'Hm.', by: 'me' }),
    ),
    reason: '"by"',
  },
  {
    problem: 'has a comment with no text',
    text: JSON.stringify(withComment({ anchor: { kind: 'part', id: 'a' }, kind: 'question' })),
    reason: 'text',
  },
  {
    problem: 'has a comment of a kind the page does not offer',
    text: JSON.stringify(
      withComment({ anchor: { kind: 'part', id: 'a' }, kind: 'praise', text: 'Nice.' }),
    ),
    reason: 'kind',
  },
  {
    problem: 'has a comment on an anchor kind the page does not offer',
    text: JSON.stringify(
      withComment({ anchor: { kind: 'commit', id: 'a' }, kind: 'question', text: 'Hm.' }),
    ),
    reason: 'anchor',
  },
  {
    problem: 'has two comments on one anchor',
    text: JSON.stringify({
      ...reviewWith(),
      comments: [
        { anchor: { kind: 'part', id: 'a' }, kind: 'question', text: 'Why?' },
        { anchor: { kind: 'part', id: 'a' }, kind: 'change', text: 'Split it.' },
      ],
    }),
    reason: 'part a has 2 comments; a review holds one per anchor',
  },
])('a review that $problem is rejected saying why', ({ text, reason }) => {
  expect(() => parseReview(text)).toThrow(new RegExp(`^Invalid review: .*${reason}`, 's'));
});
