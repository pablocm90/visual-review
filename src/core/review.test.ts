import { expect, test } from 'vitest';
import { parseReview } from './review.ts';

const reviewWith = (verdict = 'request-changes') => ({
  version: 5,
  verdict,
  reviewed: { range: 'a1b2c3d..e4f5a6b', pullRequest: 16 },
  read: ['web/file/App.tsx', 'rust/crate/domain'],
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
    {
      anchor: { kind: 'symbol', id: 'web/file/App.tsx#App.load' },
      kind: 'question',
      text: 'Why load twice?',
    },
    {
      anchor: {
        kind: 'decision',
        id: 'web/file/App.tsx#App.load#if (!open) return',
        text: 'if (!open) return',
      },
      kind: 'change',
      text: 'Keep this guard.',
    },
    {
      anchor: { kind: 'test', id: 'web/file/App.test.tsx#App › loads once' },
      kind: 'suggestion',
      text: 'Name the second load.',
    },
    {
      anchor: { kind: 'line', id: 'web/file/App.tsx@base:12', text: 'if (!open) return' },
      kind: 'question',
      text: 'Where did this go?',
    },
    { anchor: { kind: 'finding', id: 'metrics:cyclomatic:web/file/App.tsx' }, kind: 'fix' },
    {
      anchor: { kind: 'finding', id: 'api:signature:web/file/App.tsx#App' },
      kind: 'fine',
      text: 'Only the tests call it.',
    },
    { anchor: { kind: 'finding', id: 'notes:web/file/App.tsx' }, kind: 'explain' },
  ],
});

const withComment = (comment: object) => ({ ...reviewWith(), comments: [comment] });

test.for(['approve', 'comment', 'request-changes'])(
  'a review sent with %s reads back as that verdict, what was reviewed, the parts read and its comments, each on its anchor with its kind',
  verdict => {
    expect(parseReview(JSON.stringify(reviewWith(verdict)))).toEqual(reviewWith(verdict));
  },
);

test('a review of a range that is no pull request reads back with no pull request', () => {
  const review = { ...reviewWith(), reviewed: { range: 'HEAD..worktree' } };
  expect(parseReview(JSON.stringify(review))).toEqual(review);
});

test.for([
  { problem: 'is not JSON', text: '{ "version": 3,', reason: 'SyntaxError' },
  { problem: 'has no version', text: '{ "comments": [] }', reason: 'no "version"' },
  {
    problem: 'has a version this one does not read',
    text: '{ "version": 4, "comments": {} }',
    reason: 'version 4 is unknown; this visual-review reads version 5',
  },
  {
    problem: 'has a key no review has',
    text: JSON.stringify({ ...reviewWith(), summary: 'Fine.' }),
    reason: '"summary"',
  },
  {
    problem: 'has no verdict',
    text: JSON.stringify({ ...reviewWith(), verdict: undefined }),
    reason: 'verdict',
  },
  {
    problem: 'does not say what was reviewed',
    text: JSON.stringify({ ...reviewWith(), reviewed: undefined }),
    reason: 'reviewed',
  },
  {
    problem: 'says what was reviewed with no range',
    text: JSON.stringify({ ...reviewWith(), reviewed: { pullRequest: 16 } }),
    reason: 'range',
  },
  {
    problem: 'has a key no reviewed has',
    text: JSON.stringify({ ...reviewWith(), reviewed: { range: 'a..b', head: 'b' } }),
    reason: '"head"',
  },
  {
    problem: 'does not say which parts were read',
    text: JSON.stringify({ ...reviewWith(), read: undefined }),
    reason: 'read',
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
    problem: 'has a key no answer has',
    text: JSON.stringify(
      withComment({ anchor: { kind: 'finding', id: 'a' }, kind: 'fix', by: 'me' }),
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
    problem: 'comments on a diff line without quoting it',
    text: JSON.stringify(
      withComment({ anchor: { kind: 'line', id: 'a.ts@head:3' }, kind: 'question', text: 'Hm.' }),
    ),
    reason: 'text',
  },
  {
    problem: 'comments on a logic line without quoting it',
    text: JSON.stringify(
      withComment({ anchor: { kind: 'decision', id: 'a.ts#f#x' }, kind: 'question', text: 'Hm.' }),
    ),
    reason: 'text',
  },
  {
    problem: 'quotes a line on a part',
    text: JSON.stringify(
      withComment({ anchor: { kind: 'part', id: 'a', text: 'x' }, kind: 'question', text: 'Hm.' }),
    ),
    reason: '"text"',
  },
  {
    problem: 'answers a finding with a comment kind',
    text: JSON.stringify(
      withComment({ anchor: { kind: 'finding', id: 'a' }, kind: 'change', text: 'Split it.' }),
    ),
    reason: 'kind',
  },
  {
    problem: 'comments on a part with a finding answer',
    text: JSON.stringify(withComment({ anchor: { kind: 'part', id: 'a' }, kind: 'fix' })),
    reason: 'kind',
  },
  {
    problem: 'has two answers to one finding',
    text: JSON.stringify({
      ...reviewWith(),
      comments: [
        { anchor: { kind: 'finding', id: 'a' }, kind: 'fix' },
        { anchor: { kind: 'finding', id: 'a' }, kind: 'fine' },
      ],
    }),
    reason: 'finding a has 2 comments; a review holds one per anchor',
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
