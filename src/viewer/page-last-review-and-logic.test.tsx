// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import type { PreviousComment } from '../core/previous-comments.ts';
import type { SymbolStatement } from '../core/symbol-changes.ts';
import { findingOn, pageWith } from '../test-support/page-data.ts';
import {
  addedIfs,
  allEdges,
  buttonsIn,
  cardDepth,
  colourBy,
  decisionIn,
  decisionsIn,
  dependency,
  diffTab,
  inspector,
  landedRow,
  lastReviewSection,
  lenses,
  logicCount,
  openFold,
  openReview,
  openUndrawnFiles,
  openView,
  pageOfLogic,
  pageOfLogicToWalk,
  pageOfOrders,
  pageWithAnAnsweredFinding,
  pageWithAnUnchangedSymbol,
  pageWithPatch,
  pageWithSameNamedTests,
  pageWithUnchangedRuns,
  pageWithUndrawnFile,
  partComment,
  readingOrder,
  refundPatch,
  review,
  saidOnPart,
  scaleSteps,
  selectedPart,
  sentReview,
  showEverything,
  shown,
  sinceReview,
  symbolsOf,
  testedBy,
  topFile,
  twoFunctionsPatch,
  unchangedSymbols,
  walkedReview,
  webFile,
  webImport,
  webModule,
  whatChanged,
  write,
} from './review-page.fixtures.tsx';
import { ReviewPage } from './review-page.tsx';

afterEach(() => history.replaceState(null, '', location.pathname));

test('the last review lists the parts changed since with no comment on them, going to each; with only those it still shows', async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        sinceReview: { ...sinceReview, changedWithoutComment: ['rust/crate/application'] },
      })}
    />,
  );
  await screen.findByRole('group', { name: 'rust' });

  const quiet = within(
    within(lastReviewSection()).getByRole('list', { name: 'Changed since, no comment' }),
  );
  await user.click(quiet.getByRole('button', { name: 'application' }));

  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'application: modified' }),
  );
});

test('the last review lists what Claude changed unasked, going to each part, edge or symbol; with only those it still shows', async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({ ...review, sinceReview })}
      notes={{
        version: 2,
        tests: '',
        summary: [],
        notes: {},
        unasked: {
          'part rust/crate/application': { text: 'Renamed the helper.' },
          'edge rust/crate/cli-adapter -> rust/crate/application': { text: 'Dropped a cast.' },
          'symbol rust/crate/cli-adapter#run': { text: 'Inlined a guard.' },
        },
      }}
    />,
  );
  await screen.findByRole('group', { name: 'rust' });

  const unasked = within(
    within(lastReviewSection()).getByRole('list', { name: 'Claude also changed' }),
  );
  expect(
    within(unasked.getByRole('listitem', { name: 'application: Renamed the helper.' })).getByRole(
      'button',
      { name: 'application' },
    ),
  ).toBeTruthy();
  expect(
    unasked.getByRole('listitem', { name: 'cli-adapter → application: Dropped a cast.' }),
  ).toBeTruthy();

  expect(unasked.getByText('Renamed the helper.')).toBeTruthy();

  await user.click(unasked.getByRole('button', { name: 'application' }));

  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'application: modified' }),
  );

  await user.click(unasked.getByRole('button', { name: 'run in cli-adapter' }));

  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'cli-adapter: added' }));
});

test.for([
  {
    row: 'a decision',
    page: () => pageWithUnchangedRuns(),
    key: 'decision web/file/runs.ts#runs#if (c)',
    name: 'if (c)',
    node: 'runs.ts: modified',
  },
  {
    row: 'a test',
    page: () => pageWithSameNamedTests(),
    key: 'test total.test.ts#drops totals',
    name: 'drops totals',
    node: 'total.ts: modified',
  },
  {
    row: 'a diff line',
    page: () =>
      pageWith({
        range: review.range,
        diff: {
          nodes: [
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
            topFile('two.ts', 'modified'),
          ],
          edges: [],
        },
        patches: [twoFunctionsPatch()],
      }),
    key: 'line web/src/two.ts@base:5',
    name: 'two.ts:5 "return 3;"',
    node: 'two.ts: modified',
  },
])(
  "the last review names what Claude changed unasked on $row by its row, going to its file's node",
  async ({ page, key, name, node }) => {
    const user = userEvent.setup();
    render(
      <ReviewPage
        review={{ ...page(), sinceReview }}
        notes={{
          version: 2,
          tests: '',
          summary: [],
          notes: {},
          unasked: { [key]: { text: 'Tidied.' } },
        }}
      />,
    );
    await screen.findByRole('button', { name: node });

    const unasked = within(
      within(lastReviewSection()).getByRole('list', { name: 'Claude also changed' }),
    );
    await user.click(
      within(unasked.getByRole('listitem', { name: `${name}: Tidied.` })).getByRole('button', {
        name,
      }),
    );

    expect(document.activeElement).toBe(screen.getByRole('button', { name: node }));
  },
);

test('a last comment on a part or an edge shows under its anchor in the Note panel, with no send too', async () => {
  const user = userEvent.setup();
  const sha = 'c0ffee4d5e6fa7b8c9d0a1b2c3d4e5f6a7b8c9d0';
  const edge = 'rust/crate/cli-adapter -> rust/crate/application';
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        sinceReview: {
          ...sinceReview,
          comments: [
            saidOnPart('rust/crate/old-name', {
              target: 'rust/crate/application',
              kind: 'change',
              text: 'Split this.',
              changedSince: [{ sha, subject: 'split the application', files: [] }],
            }),
            {
              anchor: { kind: 'edge', id: 'rust/crate/old-name -> rust/crate/application' },
              kind: 'question',
              text: 'Why this way?',
              target: edge,
            },
          ],
        },
      })}
    />,
  );
  await screen.findByRole('group', { name: 'rust' });

  await user.click(screen.getByRole('button', { name: 'application: modified' }));
  const said = within(inspector()).getByRole('note', {
    name: 'Last review: Change this, Changed since',
  });
  expect(within(said).getByText('Split this.')).toBeTruthy();
  expect(within(said).getByText('split the application')).toBeTruthy();

  await user.click(
    within(lastReviewSection()).getByRole('button', { name: 'cli-adapter → application' }),
  );
  expect(
    within(
      within(inspector()).getByRole('note', { name: 'Last review: Question, As it was' }),
    ).getByText('Why this way?'),
  ).toBeTruthy();
  expect(within(inspector()).queryByText('Split this.')).toBeNull();
});

test("Claude's answer shows under its comment, in the last review and under the anchor, and a comment with none shows no answer", async () => {
  const user = userEvent.setup();
  const sha = 'c0ffee4d5e6fa7b8c9d0a1b2c3d4e5f6a7b8c9d0';
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        sinceReview: {
          ...sinceReview,
          comments: [
            saidOnPart('rust/crate/application', { kind: 'change', text: 'Split this.' }),
            saidOnPart('rust/crate/cli-adapter', { text: 'Why this name?' }),
            saidOnPart('rust/crate/domain', { kind: 'suggestion', text: 'Inline it?' }),
          ],
        },
      })}
      notes={{
        version: 2,
        tests: '',
        summary: [],
        notes: {},
        answers: {
          'part rust/crate/application': { status: 'done', commit: sha, text: 'Split in two.' },
          'part rust/crate/domain': { status: 'declined', text: 'It has two callers.' },
        },
      }}
    />,
  );
  await screen.findByRole('group', { name: 'rust' });

  const last = within(lastReviewSection());
  const done = within(
    last.getByRole('listitem', { name: 'application: Change this, As it was' }),
  ).getByRole('note', { name: 'Claude: Done' });
  expect(within(done).getByText('c0ffee4')).toBeTruthy();
  expect(within(done).getByText('Split in two.')).toBeTruthy();
  expect(last.getByRole('note', { name: 'Claude: Declined' }).textContent).toContain(
    'It has two callers.',
  );
  expect(
    within(last.getByRole('listitem', { name: /^cli-adapter/ })).queryByRole('note'),
  ).toBeNull();

  await user.click(screen.getByRole('button', { name: 'application: modified' }));
  const said = within(inspector()).getByRole('note', { name: /^Last review/ });
  expect(
    within(within(said).getByRole('note', { name: 'Claude: Done' })).getByText('Split in two.'),
  ).toBeTruthy();
});

test('a last comment is resolved from the last review or under its anchor, sent as it was said, and pressing Resolve again takes it back', async () => {
  const user = userEvent.setup();
  const sent = vi.fn(async () => {});
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        sinceReview: {
          ...sinceReview,
          comments: [
            saidOnPart('rust/crate/old-name', { target: 'rust/crate/application' }),
            saidOnPart('rust/crate/cli-adapter'),
            saidOnPart('rust/crate/domain'),
          ],
        },
      })}
      send={sent}
    />,
  );
  await screen.findByRole('group', { name: 'rust' });
  const resolveIn = (name: RegExp) =>
    within(within(lastReviewSection()).getByRole('listitem', { name })).getByRole('button', {
      name: 'Resolve',
    });

  await user.click(resolveIn(/^application/));
  await user.click(resolveIn(/^domain/));
  await user.click(screen.getByRole('button', { name: 'cli-adapter: added' }));
  const underAnchor = within(
    within(inspector()).getByRole('note', { name: /^Last review/ }),
  ).getByRole('button', { name: 'Resolve' });
  await user.click(underAnchor);
  expect(underAnchor.getAttribute('aria-pressed')).toBe('true');
  expect(resolveIn(/^cli-adapter/).getAttribute('aria-pressed')).toBe('true');
  await user.click(resolveIn(/^domain/));
  expect(resolveIn(/^domain/).getAttribute('aria-pressed')).toBe('false');

  await openReview(user);
  const tray = within(screen.getByRole('region', { name: 'Review tray' }));
  expect(tray.getByText(/drafted/).textContent).toBe('Nothing drafted · 2 resolved');
  const listed = within(tray.getByRole('list', { name: 'Resolved' }));
  expect(listed.getAllByRole('listitem').map(item => item.textContent)).toEqual([
    'application Resolved',
    'cli-adapter Resolved',
  ]);
  expect(tray.getByLabelText('What Claude gets').textContent).toContain(
    'resolved  application\nresolved  cli-adapter',
  );
  await user.click(listed.getByRole('button', { name: 'application' }));
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'application: modified' }),
  );

  await user.click(screen.getByRole('button', { name: 'Send to Claude' }));

  expect(sent).toHaveBeenCalledExactlyOnceWith(
    sentReview({
      verdict: 'approve',
      resolved: [
        { kind: 'part', id: 'rust/crate/old-name' },
        { kind: 'part', id: 'rust/crate/cli-adapter' },
      ],
    }),
  );
});

test('a last comment takes a reply on its anchor at the head, beside a resolve of the same anchor, and holds its draft under the anchor', async () => {
  const user = userEvent.setup();
  const sent = vi.fn(async () => {});
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        sinceReview: {
          ...sinceReview,
          comments: [
            saidOnPart('rust/crate/old-name', { target: 'rust/crate/application' }),
            saidOnPart('rust/crate/cli-adapter'),
            saidOnPart('rust/crate/domain'),
          ],
        },
      })}
      send={sent}
    />,
  );
  await screen.findByRole('group', { name: 'rust' });
  const said = (name: RegExp) =>
    within(within(lastReviewSection()).getByRole('listitem', { name }));

  const reply = said(/^application/).getByRole('button', { name: 'Reply' });
  expect(reply.getAttribute('aria-expanded')).toBe('false');
  expect(said(/^application/).queryByRole('textbox', { name: 'Your comment' })).toBeNull();
  await user.click(reply);
  expect(reply.getAttribute('aria-expanded')).toBe('true');
  await write(user, said(/^application/).getByRole('textbox', { name: 'Your comment' }), 'Still?');
  await user.click(said(/^application/).getByRole('button', { name: 'Resolve' }));
  await user.click(said(/^domain/).getByRole('button', { name: 'Resolve' }));

  await user.click(screen.getByRole('button', { name: 'application: modified' }));
  const underAnchor = within(within(inspector()).getByRole('note', { name: /^Last review/ }));
  expect(underAnchor.getByRole('button', { name: 'Reply' }).getAttribute('aria-expanded')).toBe(
    'true',
  );
  expect(underAnchor.getByRole<HTMLTextAreaElement>('textbox').value).toBe('Still?');

  await openReview(user);
  await user.click(screen.getByRole('button', { name: 'Send to Claude' }));

  expect(sent).toHaveBeenCalledExactlyOnceWith(
    sentReview({
      resolved: [
        { kind: 'part', id: 'rust/crate/old-name' },
        { kind: 'part', id: 'rust/crate/domain' },
      ],
      comments: [
        {
          anchor: { kind: 'part', id: 'rust/crate/application' },
          kind: 'question',
          text: 'Still?',
        },
      ],
    }),
  );
});

test('a part with a last comment takes Reply and no comment field in its Note panel; one with none keeps the field', async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        sinceReview: { ...sinceReview, comments: [saidOnPart('rust/crate/application')] },
      })}
      send={async () => {}}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'domain: unchanged' }));
  expect(await partComment(user)).toBeTruthy();

  await user.click(screen.getByRole('button', { name: 'application: modified' }));
  expect(within(inspector()).getByRole('button', { name: 'Reply' })).toBeTruthy();
  expect(within(inspector()).queryByRole('textbox', { name: 'Your comment' })).toBeNull();
});

test('the Note panel opens Reply by the part selected: a draft elsewhere shows on going to it, and an open Reply stays with its part', async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        sinceReview: {
          ...sinceReview,
          comments: [
            saidOnPart('rust/crate/application'),
            saidOnPart('rust/crate/cli-adapter'),
            saidOnPart('rust/crate/domain'),
          ],
        },
      })}
      send={async () => {}}
    />,
  );
  await screen.findByRole('group', { name: 'rust' });
  const said = within(within(lastReviewSection()).getByRole('listitem', { name: /^application/ }));
  await user.click(said.getByRole('button', { name: 'Reply' }));
  await write(user, said.getByRole('textbox', { name: 'Your comment' }), 'Still?');

  await user.click(screen.getByRole('button', { name: 'cli-adapter: added' }));
  await user.click(within(inspector()).getByRole('button', { name: 'Reply' }));
  expect(within(inspector()).getByRole('textbox', { name: 'Your comment' })).toBeTruthy();

  await user.click(screen.getByRole('button', { name: 'domain: unchanged' }));
  expect(within(inspector()).getByRole('button', { name: 'Reply' })).toBeTruthy();
  expect(within(inspector()).queryByRole('textbox', { name: 'Your comment' })).toBeNull();

  await openReview(user);
  const tray = within(screen.getByRole('region', { name: 'Review tray' }));
  await user.click(tray.getByRole('button', { name: 'application' }));
  expect(within(inspector()).getByRole<HTMLTextAreaElement>('textbox').value).toBe('Still?');

  await user.click(within(inspector()).getByRole('button', { name: 'Reply' }));
  expect(within(inspector()).queryByRole('textbox', { name: 'Your comment' })).toBeNull();
  await user.click(tray.getByRole('button', { name: 'application' }));
  expect(within(inspector()).getByRole<HTMLTextAreaElement>('textbox').value).toBe('Still?');
});

test("a reply on a symbol whose file was renamed since takes its comment's target: a button, its rank, and its part no longer read with nothing to say", async () => {
  const user = userEvent.setup();
  const goneSince = 'rust/crate/old-name#tax';
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        readingOrder: { parts: ['rust/crate/application', 'rust/crate/domain'], cycles: [] },
        sinceReview: {
          ...sinceReview,
          comments: [
            saidOnPart('rust/crate/domain'),
            {
              anchor: { kind: 'symbol', id: goneSince },
              kind: 'question',
              text: 'Why?',
              target: 'rust/crate/application',
            },
          ],
        },
      })}
      send={async () => {}}
    />,
  );
  await screen.findByRole('group', { name: 'rust' });
  const said = (name: RegExp) =>
    within(within(lastReviewSection()).getByRole('listitem', { name }));
  const replyOn = async (name: RegExp) => {
    await user.click(said(name).getByRole('button', { name: 'Reply' }));
    await write(user, said(name).getByRole('textbox', { name: 'Your comment' }), 'Still?');
  };
  await replyOn(/^domain/);
  await replyOn(/tax/);
  await user.click(screen.getByRole('button', { name: 'application: modified' }));
  await user.keyboard('a');

  await openReview(user);
  const drafts = within(screen.getByRole('list', { name: 'Drafts' }));
  expect(drafts.getAllByRole('listitem').map(item => item.textContent)).toEqual([
    expect.stringMatching(/tax/),
    expect.stringMatching(/^domain/),
  ]);
  expect(screen.getByLabelText('What Claude gets').textContent).toContain('read 1 of 2');
  expect(
    within(screen.getByRole('list', { name: 'Read, nothing to say' })).queryAllByRole('listitem'),
  ).toEqual([]);

  await user.click(screen.getByRole('button', { name: 'domain: unchanged' }));
  await user.click(drafts.getByRole('button', { name: /tax/ }));
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'application: modified' }),
  );
});

test('a symbol with a last comment takes Reply and no Comment, and the logic line under it keeps its own', async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={{
        ...pageWithAnUnchangedSymbol(),
        sinceReview: {
          ...sinceReview,
          comments: [
            {
              anchor: { kind: 'symbol', id: 'web/file/tax.ts#tax' },
              kind: 'question',
              text: 'Why?',
            },
          ],
        },
      }}
      send={async () => {}}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'tax.ts: modified' }));

  const symbol = within(whatChanged()).getByRole('listitem', { name: /^function tax: edited/ });
  expect(within(symbol).getByRole('button', { name: 'Reply' })).toBeTruthy();
  expect(within(symbol).queryByRole('button', { name: 'Comment on function tax' })).toBeNull();
  expect(
    within(symbol).getByRole('button', { name: 'Comment on added guard: if (!rate) return' }),
  ).toBeTruthy();
});

test('a diff line with a last comment takes Reply and no Comment, while a row a drifted comment shows at keeps its own, a different anchor', async () => {
  const user = userEvent.setup();
  const onHead = (line: number, text: string): PreviousComment => ({
    anchor: { kind: 'line', id: `web/src/x.ts@head:${line}`, text },
    kind: 'question',
    text: 'Why?',
  });
  render(
    <ReviewPage
      review={{
        ...pageWithPatch('@@ -12,1 +20,2 @@', ' const y = 0;', '+const x = 2;'),
        sinceReview: {
          ...sinceReview,
          comments: [onHead(20, 'const y = 0;'), onHead(5, 'const x = 2;')],
        },
      }}
      send={async () => {}}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'x.ts: modified' }));
  await openFold(user, 'Full diff');

  expect(within(diffTab()).getAllByRole('button', { name: 'Reply' })).toHaveLength(2);
  expect(
    within(diffTab())
      .getAllByRole('button', { name: /^Comment on/ })
      .map(button => button.getAttribute('aria-label')),
  ).toEqual(['Comment on x.ts:21 "const x = 2;"']);
});

test("a row at a drifted comment's old number, reading otherwise, keeps its Comment", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={{
        ...pageWithPatch('@@ -12,1 +20,2 @@', ' const y = 0;', '+const x = 2;'),
        sinceReview: {
          ...sinceReview,
          comments: [
            {
              anchor: { kind: 'line', id: 'web/src/x.ts@head:20', text: 'const x = 2;' },
              kind: 'question',
              text: 'Why?',
            },
          ],
        },
      }}
      send={async () => {}}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'x.ts: modified' }));
  await openFold(user, 'Full diff');

  expect(
    within(diffTab())
      .getAllByRole('button', { name: /^Comment on/ })
      .map(button => button.getAttribute('aria-label')),
  ).toEqual(['Comment on x.ts:20 "const y = 0;"', 'Comment on x.ts:21 "const x = 2;"']);
});

test.for([
  { where: 'at its row', said: 'const y = 0;' },
  { where: 'atop the patch, no row reading the same', said: 'vanished();' },
])('going from the tray to a reply on a diff line opens it $where', async ({ said }) => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={{
        ...pageWithPatch('@@ -12,1 +20,2 @@', ' const y = 0;', '+const x = 2;'),
        sinceReview: {
          ...sinceReview,
          comments: [
            {
              anchor: { kind: 'line', id: 'web/src/x.ts@head:20', text: said },
              kind: 'question',
              text: 'Why?',
            },
          ],
        },
      }}
      send={async () => {}}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'x.ts: modified' }));
  await openFold(user, 'Full diff');
  const reply = within(diffTab()).getByRole('button', { name: 'Reply' });
  await user.click(reply);
  await write(user, within(diffTab()).getByRole('textbox', { name: 'Your comment' }), 'Because.');
  await user.click(reply);
  expect(within(diffTab()).queryByRole('textbox', { name: 'Your comment' })).toBeNull();

  await openReview(user);
  await user.click(
    within(screen.getByRole('list', { name: 'Drafts' })).getByRole('button', {
      name: `x.ts:20 "${said}"`,
    }),
  );

  expect(within(diffTab()).getByRole('textbox', { name: 'Your comment' })).toHaveProperty(
    'value',
    'Because.',
  );
});

test('a comment that asks for something offers Resolve, a comment and not a finding answer offers Reply, and only on a served page', async () => {
  const comments: ReadonlyArray<PreviousComment> = [
    saidOnPart('rust/crate/application'),
    { anchor: { kind: 'finding', id: 'metrics:fine' }, kind: 'fine' },
    { anchor: { kind: 'finding', id: 'metrics:fix' }, kind: 'fix' },
  ];
  const page = pageWith({ ...review, sinceReview: { ...sinceReview, comments } });
  const { unmount } = render(<ReviewPage review={page} send={async () => {}} />);
  await screen.findByRole('group', { name: 'rust' });
  const offering = (name: string) =>
    within(lastReviewSection())
      .queryAllByRole('button', { name })
      .map(button => button.closest('li')?.getAttribute('aria-label'));

  expect(offering('Resolve')).toEqual([
    'application: Question, As it was',
    'metrics:fix: Fix this, As it was',
  ]);
  expect(offering('Reply')).toEqual(['application: Question, As it was']);
  unmount();

  render(<ReviewPage review={page} />);
  await screen.findByRole('group', { name: 'rust' });
  expect(offering('Resolve')).toEqual([]);
  expect(offering('Reply')).toEqual([]);
});

test('a last comment on an edge shows on the arrow drawn in its place, closed box or merged, named by its edge, unless its edge is drawn apart', async () => {
  const user = userEvent.setup();
  const cart = 'web/file/orders/cart.ts -> web/file/billing/invoice.ts';
  const checkout = 'web/file/orders/checkout.ts -> web/file/billing/invoice.ts';
  const saidOnImport = (target: string, text: string) => ({
    anchor: { kind: 'edge' as const, id: target },
    kind: 'question' as const,
    text,
    target,
  });
  render(
    <ReviewPage
      review={pageWith({
        range: review.range,
        diff: {
          nodes: [
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
            webModule('orders'),
            webModule('billing'),
            webFile('orders', 'cart.ts'),
            webFile('orders', 'checkout.ts'),
            webFile('billing', 'invoice.ts'),
          ],
          edges: [
            webImport('orders/cart.ts', 'billing/invoice.ts', 'unchanged'),
            webImport('orders/checkout.ts', 'billing/invoice.ts', 'unchanged'),
          ],
        },
        sinceReview: {
          ...sinceReview,
          comments: [
            saidOnImport(cart, 'Why the cart?'),
            saidOnImport(checkout, 'Why the checkout?'),
          ],
        },
      })}
      notes={{
        version: 2,
        tests: '',
        summary: [],
        notes: { [`edge ${checkout}`]: { text: 'Paid.' } },
      }}
    />,
  );
  await showEverything(user);
  const web = await screen.findByRole('group', { name: 'web' });
  const said = (text: string) => within(inspector()).queryByText(text);

  await user.click(within(web).getByRole('button', { name: 'orders → billing: unchanged' }));
  expect(said('Why the cart?')).toBeTruthy();
  expect(said('Why the checkout?')).toBeTruthy();
  expect(within(inspector()).getByText('cart.ts → invoice.ts')).toBeTruthy();

  await user.click(within(web).getByRole('button', { name: 'Expand orders' }));
  await user.click(within(web).getByRole('button', { name: 'Expand billing' }));
  await within(web).findByRole('group', { name: 'billing' });
  await user.click(await within(web).findByRole('button', { name: 'orders → billing: unchanged' }));
  expect(said('Why the cart?')).toBeTruthy();
  expect(said('Why the checkout?')).toBeNull();
  expect(said('No note')).toBeNull();

  await user.click(
    await within(web).findByRole('button', { name: 'checkout.ts → invoice.ts: unchanged' }),
  );
  expect(said('Why the checkout?')).toBeTruthy();
  expect(said('Why the cart?')).toBeNull();

  await user.click(await allEdges(user));
  await user.click(within(web).getByRole('button', { name: 'Collapse orders' }));
  await user.click(
    await within(web).findByRole('button', { name: 'orders → invoice.ts: unchanged' }),
  );
  expect(said('Why the cart?')).toBeTruthy();
  expect(said('Why the checkout?')).toBeTruthy();
});

test('a last comment on a symbol or a logic line shows under it in What changed, with no send too', async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={{
        ...pageWithAnUnchangedSymbol(),
        sinceReview: {
          ...sinceReview,
          comments: [
            {
              anchor: { kind: 'symbol', id: 'web/file/tax.ts#tax' },
              kind: 'change',
              text: 'Rename this.',
            },
            {
              anchor: {
                kind: 'decision',
                id: 'web/file/tax.ts#tax#if (!rate) return',
                text: 'if (!rate) return',
              },
              kind: 'question',
              text: 'What of zero?',
              changedSince: [],
            },
          ],
        },
      }}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'tax.ts: modified' }));

  const symbol = within(whatChanged()).getByRole('listitem', { name: /^function tax: edited/ });
  expect(
    within(
      within(symbol).getByRole('note', { name: 'Last review: Change this, As it was' }),
    ).getByText('Rename this.'),
  ).toBeTruthy();
  const decision = within(symbol).getByRole('listitem', { name: /^added guard/ });
  expect(
    within(
      within(decision).getByRole('note', { name: 'Last review: Question, Changed since' }),
    ).getByText('What of zero?'),
  ).toBeTruthy();
  expect(within(decision).queryByText('Rename this.')).toBeNull();
});

test('a last comment on an unchanged symbol brings up What changed and opens the unchanged ones', async () => {
  const user = userEvent.setup();
  const page = pageWithAnUnchangedSymbol();
  render(
    <ReviewPage
      review={{
        ...page,
        symbols: [
          symbolsOf('web/file/tax.ts', [
            {
              name: 'round',
              kind: 'function',
              exported: { base: false, head: false },
              change: 'unchanged',
            },
          ]),
        ],
        sinceReview: {
          ...sinceReview,
          comments: [
            {
              anchor: { kind: 'symbol', id: 'web/file/tax.ts#round' },
              kind: 'question',
              text: 'Why not?',
            },
          ],
        },
      }}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'tax.ts: modified' }));

  expect(unchangedSymbols().hasAttribute('open')).toBe(true);
  expect(within(unchangedSymbols()).getByText('Why not?')).toBeTruthy();
});

test('a last comment on a test shows under it on the Tests screen and under Tested by, with no send too', async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={{
        ...pageWithSameNamedTests(),
        sinceReview: {
          ...sinceReview,
          comments: [
            {
              anchor: { kind: 'test', id: 'total.test.ts#drops totals' },
              kind: 'question',
              text: 'Why gone?',
            },
          ],
        },
      }}
    />,
  );
  const said = (place: HTMLElement) =>
    within(within(place).getByRole('listitem', { name: 'drops totals: removed' })).getByRole(
      'note',
      { name: 'Last review: Question, As it was' },
    );

  await user.click(await screen.findByRole('button', { name: 'total.ts: modified' }));
  expect(within(said(testedBy())).getByText('Why gone?')).toBeTruthy();

  await user.click(screen.getByRole('link', { name: 'Tests 3' }));
  expect(
    within(said(screen.getByRole('region', { name: 'Test changes' }))).getByText('Why gone?'),
  ).toBeTruthy();
});

test('a last comment on a diff line shows at the nearest row reading the same on its side, or atop the patch when none does', async () => {
  const user = userEvent.setup();
  const onHead = (line: number, text: string, said: string): PreviousComment => ({
    anchor: { kind: 'line', id: `web/src/x.ts@head:${line}`, text },
    kind: 'question',
    text: said,
  });
  render(
    <ReviewPage
      review={{
        ...pageWithPatch(
          '@@ -12,2 +20,4 @@',
          ' const y = 0;',
          '-const x = 1;',
          '+const x = 2;',
          '+other();',
          '+const x = 2;',
        ),
        sinceReview: {
          ...sinceReview,
          comments: [
            onHead(5, 'const x = 2;', 'Near the first.'),
            onHead(24, 'const x = 2;', 'Near the last.'),
            {
              anchor: { kind: 'line', id: 'web/src/x.ts@base:40', text: 'const x = 1;' },
              kind: 'change',
              text: 'On the removed one.',
              changedSince: [],
            },
            onHead(13, 'const x = 1;', 'On the other side.'),
            onHead(21, 'vanished();', 'Gone since.'),
          ],
        },
      }}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'x.ts: modified' }));
  await openFold(user, 'Full diff');

  const [first, , last] = within(diffTab()).getAllByRole('insertion');
  const removed = within(diffTab()).getByRole('deletion');
  const hunk = within(diffTab()).getByText(/-12,2/);
  const noteSaying = (text: string) => within(diffTab()).getByText(text).closest('[role="note"]');
  expect(first?.contains(noteSaying('Near the first.'))).toBe(true);
  expect(last?.contains(noteSaying('Near the last.'))).toBe(true);
  expect(
    within(removed).getByRole('note', { name: 'Last review: Change this, Changed since' }),
  ).toBeTruthy();
  ['On the other side.', 'Gone since.'].forEach(text => {
    expect(
      noteSaying(text)?.compareDocumentPosition(hunk) === Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(true);
  });
});

test('a patch holding a last comment opens by itself', async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={{
        ...pageWithUndrawnFile(),
        sinceReview: {
          ...sinceReview,
          comments: [
            {
              anchor: { kind: 'line', id: 'README.md@head:1', text: 'new' },
              kind: 'question',
              text: 'Why new?',
            },
          ],
        },
      }}
    />,
  );

  await openUndrawnFiles(user);

  expect(within(inspector()).getByRole('group', { name: 'README.md' }).hasAttribute('open')).toBe(
    true,
  );
});

test('going to a last comment on a diff line lands on the row it shows at, the numbers having moved', async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={{
        ...pageWithPatch('@@ -12,1 +20,2 @@', ' const y = 0;', '+const x = 2;'),
        sinceReview: {
          ...sinceReview,
          comments: [
            {
              anchor: { kind: 'line', id: 'web/src/x.ts@head:20', text: 'const x = 2;' },
              kind: 'question',
              text: 'Why 2?',
              target: 'web/file/x.ts',
            },
          ],
        },
      }}
    />,
  );
  await screen.findByRole('button', { name: 'x.ts: modified' });

  await user.click(within(lastReviewSection()).getByRole('button', { name: /^x\.ts:20/ }));

  expect(within(diffTab()).getByRole('insertion', { current: true }).textContent).toContain(
    'Why 2?',
  );
});

test('a last answer to a finding shows under it in the rail, not in Start here', async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWithAnAnsweredFinding({
        comments: [{ anchor: { kind: 'finding', id: 'logic:a' }, kind: 'explain', text: 'Why?' }],
      })}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'Show 2 findings' }));

  const answered = within(screen.getByRole('region', { name: 'Logic' }))
    .getByRole('button', { name: /^application: lost a guard/ })
    .closest('li');
  expect(
    within(answered ?? document.body).getByRole('note', {
      name: 'Last review: Explain, As it was',
    }),
  ).toBeTruthy();
  expect(within(screen.getByRole('region', { name: 'Start here' })).queryByRole('note')).toBeNull();
  expect(screen.getAllByRole('note', { name: /^Last review/ })).toHaveLength(1);
});

test("closing a stop's outside files returns to the landing with focus on the graph, the stop that opened them having gone", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage review={{ ...walkedReview(), undrawn: [{ path: 'README.md', patch: '' }] }} />,
  );
  await screen.findByRole('group', { name: 'rust' });

  await user.keyboard('j');
  await user.click(within(readingOrder()).getByRole('button', { name: '4 README.md' }));
  await user.click(screen.getByRole('button', { name: 'Close inspector' }));

  expect(document.activeElement).toBe(screen.getByRole('group', { name: 'Graph' }));
});

test('Escape from a stop with no part, the outside files, leaves focus on the graph', async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage review={{ ...walkedReview(), undrawn: [{ path: 'README.md', patch: '' }] }} />,
  );
  await screen.findByRole('group', { name: 'rust' });

  await user.keyboard('j');
  await user.click(within(readingOrder()).getByRole('button', { name: '4 README.md' }));
  await user.keyboard('{Escape}');

  expect(document.activeElement).toBe(screen.getByRole('group', { name: 'Graph' }));
});

test("with changed logic, Show offers 'Logic only' after 'Changes only'; picked, it draws the files holding a changed decision and every edge between them", async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={pageOfLogic()} />);
  const web = await screen.findByRole('group', { name: 'web' });
  expect(
    within(screen.getByRole('group', { name: 'Show' }))
      .getAllByRole('button')
      .map(button => button.textContent),
  ).toEqual(['Changes only', 'Logic only', 'Changed + 1 hop', 'Everything']);

  await user.click(shown('Logic only'));

  await waitFor(() =>
    expect(buttonsIn(web)).toEqual([
      'refund.ts → cart.ts: unchanged',
      'refund.ts: modified',
      'Code of refund.ts',
      'added if: if (late)',
      'cart.ts: modified',
      'Code of cart.ts',
      'added if: if (empty)',
    ]),
  );
});

test("on 'Logic only' a file holds a row per function with a changed decision, each with a tick per decision named by it", async () => {
  const user = userEvent.setup();
  const same = {
    change: 'same',
    kind: 'guard',
    depth: 0,
    head: 'if (ok) return',
    line: 1,
  } as const;
  render(
    <ReviewPage
      review={{
        ...pageOfLogic(),
        symbols: [
          symbolsOf('web/file/refund.ts', [
            {
              ...decisionIn('refund', 'if (late)'),
              logic: [same, ...(decisionIn('', 'if (late)').logic ?? [])],
            },
            { ...decisionIn('tidy', ''), logic: [same] },
          ]),
          symbolsOf('web/file/cart.ts', [decisionIn('total', 'if (empty)')]),
        ],
      }}
    />,
  );

  const web = await screen.findByRole('group', { name: 'web' });
  const before = await within(web).findByRole('button', { name: /^refund\.ts: modified/ });
  expect(within(before).queryAllByRole('group')).toEqual([]);

  await user.click(screen.getByRole('button', { name: 'Logic only' }));

  const refund = await within(web).findByRole('button', { name: /^refund\.ts: modified/ });
  const rows = await within(refund).findAllByRole('group');
  expect(rows.map(row => row.getAttribute('aria-label'))).toEqual(['Marks of function refund']);
  expect(
    within(rows[0] as HTMLElement)
      .getAllByRole('button')
      .map(tick => tick.getAttribute('aria-label')),
  ).toEqual(['same guard: if (ok) return', 'added if: if (late)']);
});

test("on 'Logic only' with the cards at their marks, a file's card counts its changed decisions and exits and is as big as its rows", async () => {
  const user = userEvent.setup();
  const exit = { change: 'removed', kind: 'throw', depth: 0, base: 'throw oops', line: 4 } as const;
  const same = { change: 'same', kind: 'if', depth: 0, head: 'if (ok)', line: 9 } as const;
  render(
    <ReviewPage
      review={{
        ...pageOfLogic(),
        symbols: [
          symbolsOf('web/file/refund.ts', [
            {
              ...addedIfs('refund', 2),
              logic: [same, ...(addedIfs('refund', 2).logic ?? []), exit],
            },
            addedIfs('tidy', 1),
          ]),
          symbolsOf('web/file/cart.ts', [addedIfs('total', 20)]),
        ],
      }}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'Logic only' }));
  await user.click(cardDepth('Marks'));

  const web = await screen.findByRole('group', { name: 'web' });
  const refund = await within(web).findByRole('button', { name: /^refund\.ts: modified/ });
  const cart = within(web).getByRole('button', { name: /^cart\.ts: modified/ });
  expect(within(refund).getByText('refund.ts')).toBeTruthy();
  expect(within(refund).getByText('4 · 1 exit')).toBeTruthy();
  expect(within(refund).getByText('3 of 4')).toBeTruthy();
  const sizeOf = (node: HTMLElement) => node.querySelector('rect');
  await waitFor(() =>
    expect(Number(sizeOf(refund)?.getAttribute('height'))).toBeGreaterThan(
      Number(sizeOf(cart)?.getAttribute('height')),
    ),
  );
  expect(Number(sizeOf(cart)?.getAttribute('width'))).toBeGreaterThan(
    Number(sizeOf(refund)?.getAttribute('width')),
  );
});

test("a logic change's diff opens under it, the decision's own row tagged with its change and kind", async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={{ ...pageOfLogic(), patches: [refundPatch] }} />);

  await user.click(await screen.findByRole('button', { name: 'refund.ts: modified' }));
  const diff = within(screen.getByRole('region', { name: 'What changed' })).getByRole('listitem', {
    name: 'Diff under added if: if (late)',
  });
  const tagged = [...diff.querySelectorAll('[data-decision]')].map(row => [
    row.tagName,
    row.getAttribute('data-decision'),
    row.textContent,
  ]);
  expect(tagged).toEqual([['INS', '+ if', '+  if (late) return;']]);
  expect(diff.textContent).toContain('function refund() {');
});

test("on 'Logic only' the cards show each function's changed decisions; Code shows the rows they sit on, tagged, for every card or, pressed on one, for that card alone", async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={{ ...pageOfLogic(), patches: [refundPatch] }} />);

  await user.click(await screen.findByRole('button', { name: 'Logic only' }));
  const web = await screen.findByRole('group', { name: 'web' });
  const refund = () => within(web).getByRole('button', { name: /^refund\.ts: modified/ });
  const cart = () => within(web).getByRole('button', { name: /^cart\.ts: modified/ });
  expect(cardDepth('Decisions').getAttribute('aria-pressed')).toBe('true');
  expect(within(refund()).getByText('if (late)')).toBeTruthy();
  expect(within(cart()).getByText('if (empty)')).toBeTruthy();

  await user.click(cardDepth('Code'));
  expect(within(refund()).getByText('+ if (late) return;')).toBeTruthy();
  expect(within(refund()).getByText('function refund() {')).toBeTruthy();
  expect(within(refund()).getByText('+ if')).toBeTruthy();

  await user.click(cardDepth('Decisions'));
  const code = within(web).getByRole('button', { name: 'Code of refund.ts' });
  expect(code.getAttribute('aria-pressed')).toBe('false');
  await user.click(code);
  expect(within(refund()).getByText('+ if (late) return;')).toBeTruthy();
  expect(within(cart()).getByText('if (empty)')).toBeTruthy();
  expect(
    within(web).getByRole('button', { name: 'Code of refund.ts' }).getAttribute('aria-pressed'),
  ).toBe('true');
});

test("on 'Logic only' a tick selects its file and lands on its row in What changed; in the reading map it only goes to its part", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={{
        ...pageOfLogic(),
        readingOrder: { parts: ['web/file/refund.ts', 'web/file/cart.ts'], cycles: [] },
      }}
    />,
  );
  await user.click(await screen.findByRole('button', { name: 'Logic only' }));
  const tickOn = (file: string, name: string) =>
    within(screen.getByRole('button', { name: new RegExp(`^${file}: modified`) })).findByRole(
      'button',
      { name },
    );
  const landedRows = () => whatChanged().querySelectorAll('li[aria-current="true"]');

  await user.click(await tickOn('cart\\.ts', 'added if: if (empty)'));

  expect(landedRows()).toHaveLength(1);
  expect(landedRows()[0]?.getAttribute('aria-label')).toBe('added if: if (empty)');

  await user.keyboard('k');
  await screen.findByRole('button', { name: 'Open map' });
  await user.click(await tickOn('cart\\.ts', 'added if: if (empty)'));

  expect(
    await within(whatChanged()).findByRole('listitem', { name: 'added if: if (empty)' }),
  ).toBeTruthy();
  expect(landedRows()).toHaveLength(0);
});

test("on 'Logic only', going to a part it holds stays, and to one it doesn't goes to 'Changes only' and wider", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageOfLogic()}
      notes={{
        version: 2,
        tests: '',
        summary: [
          { text: 'The refund.', target: 'web/file/refund.ts' },
          { text: 'The styles.', target: 'web/file/styles.ts' },
        ],
        notes: {},
      }}
    />,
  );
  const web = await screen.findByRole('group', { name: 'web' });
  await within(web).findByRole('button', { name: 'refund.ts: modified' });
  const pressed = () =>
    within(screen.getByRole('group', { name: 'Show' }))
      .getAllByRole('button', { pressed: true })
      .map(button => button.textContent);
  const summary = screen.getByRole('region', { name: 'Summary' });

  await user.click(shown('Logic only'));
  await user.click(within(summary).getByRole('button', { name: 'The refund.' }));
  expect(pressed()).toEqual(['Logic only']);

  await user.click(within(summary).getByRole('button', { name: 'The styles.' }));
  expect(pressed()).toEqual(['Changes only']);
});

test("on 'Logic only' boxes are open whatever was toggled: no toggle shows, and a file in a closed box wears its own findings", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        range: 'abc123..def456',
        diff: {
          nodes: [
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
            {
              id: 'web/module/billing',
              kind: 'module',
              label: 'billing',
              parent: 'web',
              path: 'web/src/billing',
              state: 'modified',
            },
            {
              ...topFile('refund.ts', 'modified'),
              parent: 'web/module/billing',
              path: 'web/src/billing/refund.ts',
            },
            { id: 'api', kind: 'stack', label: 'api', path: 'api', state: 'unchanged' },
            {
              ...topFile('routes.ts', 'modified'),
              id: 'api/file/routes.ts',
              parent: 'api',
              path: 'api/routes.ts',
            },
          ],
          edges: [
            {
              from: 'web/file/refund.ts',
              to: 'api/file/routes.ts',
              state: 'added',
              via: ['/late'],
            },
          ],
        },
        symbols: [
          symbolsOf('web/file/refund.ts', [decisionIn('refund', 'if (late)')]),
          symbolsOf('api/file/routes.ts', [decisionIn('route', 'if (open)')]),
        ],
        findings: [findingOn('web/file/refund.ts')],
        dangling: [{ from: 'web/file/refund.ts', path: '/gone' }],
      })}
    />,
  );
  const web = await screen.findByRole('group', { name: 'web' });
  await within(web).findByRole('button', { name: 'Expand billing' });
  expect(within(web).queryByRole('button', { name: /^refund\.ts/ })).toBeNull();

  await user.click(shown('Logic only'));

  const refund = await within(web).findByRole('button', {
    name: /^refund\.ts: modified, no route for \/gone/,
  });
  expect(screen.getByRole('button', { name: 'refund.ts ⇢ routes.ts: added (/late)' })).toBeTruthy();
  expect(within(web).queryByRole('button', { name: /(Expand|Collapse) billing/ })).toBeNull();
  expect(within(refund).getByRole('img', { name: /finding/ })).toBeTruthy();
});

test("on 'Logic only' a last comment on an edge stays on its own arrow, not on the arrow between its boxes", async () => {
  const user = userEvent.setup();
  const cart = 'web/file/orders/cart.ts -> web/file/billing/invoice.ts';
  render(
    <ReviewPage
      review={pageWith({
        range: review.range,
        diff: {
          nodes: [
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
            webModule('orders'),
            webModule('billing'),
            webFile('orders', 'cart.ts', 'modified'),
            webFile('billing', 'invoice.ts', 'modified'),
          ],
          edges: [
            webImport('orders/cart.ts', 'billing/invoice.ts', 'unchanged'),
            { from: 'web/module/orders', to: 'web/module/billing', state: 'unchanged' },
          ],
        },
        symbols: [
          symbolsOf('web/file/orders/cart.ts', [decisionIn('total', 'if (empty)')]),
          symbolsOf('web/file/billing/invoice.ts', [decisionIn('bill', 'if (paid)')]),
        ],
        sinceReview: {
          ...sinceReview,
          comments: [
            {
              anchor: { kind: 'edge', id: cart },
              kind: 'question',
              text: 'Why the cart?',
              target: cart,
            },
          ],
        },
      })}
      notes={{
        version: 2,
        tests: '',
        summary: [],
        notes: { [`edge ${cart}`]: { text: 'The cart bills.' } },
      }}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'Logic only' }));

  const web = await screen.findByRole('group', { name: 'web' });
  const own = await within(web).findByRole('button', { name: 'cart.ts → invoice.ts: unchanged' });
  await user.click(within(web).getByRole('button', { name: 'orders → billing: unchanged' }));
  expect(within(inspector()).queryByText('Why the cart?')).toBeNull();
  expect(within(inspector()).queryByText('The cart bills.')).toBeNull();
  await user.click(own);
  expect(within(inspector()).getByText('Why the cart?')).toBeTruthy();
  expect(within(inspector()).getByText('The cart bills.')).toBeTruthy();
});

test("Start here opens with what the range's logic did, counting only the kinds there are, and going to it shows Logic only", async () => {
  const user = userEvent.setup();
  const line = { kind: 'if', depth: 0, line: 2 } as const;
  const logic: SymbolStatement['logic'] = [
    { ...line, change: 'added', head: 'if (late)' },
    { ...line, change: 'added', kind: 'throw', head: 'throw late' },
    { ...line, change: 'removed', base: 'if (early)' },
  ];
  render(
    <ReviewPage
      review={{
        ...pageOfLogic(),
        symbols: [
          symbolsOf('web/file/refund.ts', [{ ...decisionIn('refund', ''), logic }]),
          symbolsOf('web/file/cart.ts', [
            decisionIn('total', 'if (empty)'),
            decisionIn('count', 'if (none)'),
          ]),
        ],
        findings: [findingOn('web/file/refund.ts')],
      }}
    />,
  );
  await screen.findByRole('group', { name: 'web' });

  const band = within(screen.getByRole('region', { name: 'Start here' }));
  expect(band.getByText('1 exit · 4 added · 1 removed')).toBeTruthy();
  expect(shown('Logic only').getAttribute('aria-pressed')).toBe('false');

  await user.click(band.getByRole('button', { name: /^5 decisions changed/ }));

  expect(shown('Logic only').getAttribute('aria-pressed')).toBe('true');
  await screen.findByRole('button', { name: 'added throw: throw late' });
});

test("Start here's logic count shows with no findings, with nothing to look at or for information", async () => {
  render(<ReviewPage review={pageOfLogic()} />);
  await screen.findByRole('group', { name: 'web' });
  const band = within(screen.getByRole('region', { name: 'Start here' }));
  expect(logicCount()?.textContent).toBe('2 decisions changed in 2 functions, 2 files');
  expect(band.getByText('2 added')).toBeTruthy();
  expect(band.getByText('nothing needs a look')).toBeTruthy();
  expect(band.getByRole('button', { name: 'what was checked' })).toBeTruthy();
  expect(band.queryByRole('button', { name: 'All findings' })).toBeNull();
});

test("Start here's logic count stays with Behaviour picked and goes with another lens", async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={{ ...pageOfLogic(), findings: [findingOn('web/file/cart.ts')] }} />);
  await screen.findByRole('group', { name: 'web' });

  await user.click((await lenses(user)).getByRole('button', { name: /^Behaviour/ }));
  expect(logicCount()).not.toBeNull();

  await user.click((await lenses(user)).getByRole('button', { name: /^Contract/ }));
  expect(logicCount()).toBeNull();
});

test('Start here has no logic count with no changed decision', async () => {
  render(
    <ReviewPage
      review={{
        ...pageOfLogic(),
        symbols: [symbolsOf('web/file/styles.ts', [])],
        findings: [findingOn('web/file/styles.ts')],
      }}
    />,
  );
  await screen.findByRole('region', { name: 'Start here' });
  expect(logicCount()).toBeNull();
});

test("What changed's heading on a box sums the logic of the files it holds", async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={pageOfOrders()} />);

  await user.click(await screen.findByRole('button', { name: 'orders: modified' }));
  expect(within(whatChanged()).getAllByRole('heading', { level: 3 })[0]?.textContent).toBe(
    'What changed 2 · 2 functions decide differently, 4 decisions, 2 exits',
  );
});

test("What changed's heading on a file in a box sums its own logic, with no exits clause when it has none", async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={pageOfOrders()} />);

  await user.click(await screen.findByRole('button', { name: 'Expand orders' }));
  await user.click(await screen.findByRole('button', { name: 'cart.ts: modified' }));
  expect(within(whatChanged()).getByRole('heading', { level: 3 }).textContent).toBe(
    'What changed 1 · 1 function decides differently, 1 decision',
  );
});

test('What changed offers its key of marks when a strip shows, closed until asked, and not on a file with no logic', async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={{
        ...pageOfLogic(),
        symbols: [
          symbolsOf('web/file/cart.ts', [decisionIn('total', 'if (empty)')]),
          symbolsOf('web/file/styles.ts', [
            {
              name: 'tidy',
              kind: 'function',
              lines: {},
              exported: { base: false, head: false },
              change: 'edited',
            },
          ]),
        ],
      }}
    />,
  );
  const legend = () => within(whatChanged()).queryByRole('list', { name: 'Marks' });

  const key = () => within(whatChanged()).queryByRole('button', { name: 'Key' });

  await user.click(await screen.findByRole('button', { name: 'cart.ts: modified' }));
  expect(legend()).toBeNull();
  await user.click(key() as HTMLElement);
  expect(legend()).not.toBeNull();

  await user.click(screen.getByRole('button', { name: 'styles.ts: modified' }));
  expect(within(whatChanged()).getByRole('listitem', { name: /tidy/ })).toBeTruthy();
  expect(key()).toBeNull();
  expect(legend()).toBeNull();
});

test("on 'Logic only' the graph offers how much its cards show, and no band of marks above it; another Show choice hides the offer", async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={pageOfLogic()} />);
  await screen.findByRole('group', { name: 'web' });
  const depths = () => screen.queryByRole('group', { name: 'Cards' });
  expect(depths()).toBeNull();

  await user.click(shown('Logic only'));
  expect(
    within(depths() as HTMLElement)
      .getAllByRole('button')
      .map(button => button.textContent),
  ).toEqual(['Marks', 'Decisions', 'Code']);
  expect(screen.queryByRole('list', { name: 'Marks' })).toBeNull();

  await user.click(shown('Changes only'));
  expect(depths()).toBeNull();
});

test('Colour by Logic names each changed file with its changed decisions and the step holding them, cut at 1, 4 and 10; an unchanged one, or one whose symbols were not read, with nothing', async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={{
        ...pageOfLogic(),
        diff: {
          nodes: [
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
            ...['none.ts', 'one.ts', 'three.ts', 'four.ts', 'nine.ts', 'ten.ts'].map(file =>
              topFile(file, 'modified'),
            ),
            topFile('quiet.ts', 'unchanged'),
            topFile('unread.ts', 'modified'),
          ],
          edges: [],
        },
        symbols: [
          decisionsIn('none.ts', 0),
          decisionsIn('one.ts', 1),
          decisionsIn('three.ts', 3),
          decisionsIn('four.ts', 4),
          decisionsIn('nine.ts', 9),
          decisionsIn('ten.ts', 10),
        ],
      }}
    />,
  );
  const web = await screen.findByRole('group', { name: 'web' });

  await openView(user);
  await user.click(colourBy('Logic'));
  await user.click(shown('Everything'));

  expect(colourBy('Logic').getAttribute('aria-pressed')).toBe('true');
  expect(scaleSteps()).toEqual(['0', '1–3', '4–9', '10+']);
  await waitFor(() =>
    expect(buttonsIn(web)).toEqual([
      'none.ts: modified, decisions 0 (0)',
      'one.ts: modified, decisions 1 (1–3)',
      'three.ts: modified, decisions 3 (1–3)',
      'four.ts: modified, decisions 4 (4–9)',
      'nine.ts: modified, decisions 9 (4–9)',
      'ten.ts: modified, decisions 10 (10+)',
      'quiet.ts: unchanged',
      'unread.ts: modified',
    ]),
  );
});

test('Colour by Logic leaves an added or a removed part neutral, its decisions not being counted as changed', async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={{
        ...pageOfLogic(),
        diff: {
          nodes: [
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'modified' },
            topFile('kept.ts', 'modified'),
            topFile('new.ts', 'added'),
            topFile('gone.ts', 'removed'),
          ],
          edges: [],
        },
        symbols: [decisionsIn('kept.ts', 1), decisionsIn('new.ts', 0), decisionsIn('gone.ts', 0)],
      }}
    />,
  );
  const web = await screen.findByRole('group', { name: 'web' });

  await openView(user);
  await user.click(colourBy('Logic'));
  await user.click(shown('Everything'));

  await waitFor(() =>
    expect(buttonsIn(web)).toEqual([
      'kept.ts: modified, decisions 1 (1–3)',
      'new.ts: added',
      'gone.ts: removed',
    ]),
  );
});

test('Colour by offers Logic only on a page with a changed decision', async () => {
  const user = userEvent.setup();
  const offered = () =>
    within(screen.getByRole('group', { name: 'Colour by' }))
      .getAllByRole('button')
      .map(button => button.textContent);
  const page = render(<ReviewPage review={pageWith(review)} />);
  await screen.findByRole('group', { name: 'rust' });
  await openView(user);
  expect(offered()).toEqual(['Change', 'Churn', 'Complexity', 'Kind of change']);
  page.unmount();

  render(<ReviewPage review={pageOfLogic()} />);
  await screen.findByRole('group', { name: 'web' });
  await openView(user);
  expect(offered()).toEqual(['Change', 'Churn', 'Complexity', 'Kind of change', 'Logic']);
});

test('Colour by Logic gives a closed box the sum of the decisions inside it, not their highest', async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={{
        ...pageOfLogic(),
        diff: {
          nodes: [
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'modified' },
            webModule('lib', 'modified'),
            webFile('lib', 'two.ts', 'modified'),
            webFile('lib', 'three.ts', 'modified'),
          ],
          edges: [],
        },
        symbols: [decisionsIn('lib/two.ts', 2), decisionsIn('lib/three.ts', 3)],
      }}
    />,
  );
  const web = await screen.findByRole('group', { name: 'web' });

  await openView(user);
  await user.click(colourBy('Logic'));

  await waitFor(() =>
    expect(buttonsIn(web)).toEqual(['lib: modified, decisions 5 (4–9)', 'Expand lib']),
  );
});

test("L from the landing reads the first changed decision by reading order, landing on its row and focusing it; each L goes to the next, across files, then stays at the last; C comments on the row it's on", async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={pageOfLogicToWalk()} send={vi.fn(async () => {})} />);
  await screen.findByRole('group', { name: 'web' });

  await user.keyboard('l');
  expect(screen.getByRole('group', { name: 'Map' })).toBeDefined();
  expect(selectedPart()).toBe('cart.ts');
  expect(landedRow('added if: if (empty)').getAttribute('aria-current')).toBe('true');
  await waitFor(() => expect(document.activeElement).toBe(landedRow('added if: if (empty)')));

  await user.keyboard('l');
  expect(selectedPart()).toBe('refund.ts');
  await waitFor(() => expect(document.activeElement).toBe(landedRow('added if: if (late)')));

  await user.keyboard('l');
  expect(selectedPart()).toBe('refund.ts');
  expect(landedRow('added if: if (late)').getAttribute('aria-current')).toBe('true');

  await user.keyboard('c');
  expect(document.activeElement).toBe(
    await within(landedRow('added if: if (late)')).findByRole('textbox', { name: 'Your comment' }),
  );
});

test("the head's Next logic change goes to the next changed decision, across files, and shows neither at the last nor on a page with none", async () => {
  const user = userEvent.setup();
  const { unmount } = render(<ReviewPage review={pageOfLogicToWalk()} />);
  await screen.findByRole('group', { name: 'web' });
  const nextLogic = () => within(inspector()).queryByRole('button', { name: 'Next logic change' });

  await user.keyboard('l');
  expect(selectedPart()).toBe('cart.ts');
  await user.click(within(inspector()).getByRole('button', { name: 'Next logic change' }));
  expect(selectedPart()).toBe('refund.ts');
  expect(landedRow('added if: if (late)').getAttribute('aria-current')).toBe('true');
  expect(nextLogic()).toBeNull();
  unmount();

  render(<ReviewPage review={{ ...pageOfLogicToWalk(), symbols: [] }} />);
  const web = await screen.findByRole('group', { name: 'web' });
  await user.click(within(web).getByRole('button', { name: /^cart\.ts/ }));
  await within(inspector()).findByRole('button', { name: /^Next: / });
  expect(nextLogic()).toBeNull();
});

test("Why look leaves out what What changed already says row by row, an export added or a function's logic changed, and keeps the rest", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={{
        ...pageOfLogic(),
        findings: [
          findingOn('web/file/refund.ts'),
          findingOn('web/file/refund.ts', {
            id: 'logic:changed:refund',
            check: 'logic:changed',
            dimension: 'logic',
            title: 'function refund changed its logic',
          }),
          findingOn('web/file/refund.ts', {
            id: 'api:added:refund',
            check: 'api:added',
            dimension: 'api',
            title: 'function refund added',
          }),
        ],
      }}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'refund.ts: modified' }));
  expect(
    within(within(inspector()).getByRole('region', { name: 'Why look' }))
      .getAllByRole('listitem')
      .map(item => item.textContent),
  ).toEqual(['lines 900, over 800']);
});

test('the Tests screen folds each run of three or more unchanged tests, keeping a changed one in its place', async () => {
  const user = userEvent.setup();
  const unchanged = (name: string) => ({ kind: 'test', name, change: 'unchanged' }) as const;
  render(
    <ReviewPage
      review={{
        ...pageOfLogic(),
        tests: [
          {
            path: 'web/src/refund.test.ts',
            stack: 'web',
            statements: [
              unchanged('one'),
              unchanged('two'),
              unchanged('three'),
              { kind: 'test', name: 'late', change: 'added' },
              unchanged('four'),
            ],
          },
        ],
      }}
    />,
  );

  await user.click(await screen.findByRole('link', { name: /^Tests/ }));
  const file = await screen.findByRole('region', { name: 'web/src/refund.test.ts' });
  const fold = within(file).getByText('3 unchanged').closest('details');
  expect(fold?.open).toBe(false);
  expect(
    within(fold ?? file)
      .getAllByRole('listitem')
      .map(item => item.ariaLabel),
  ).toEqual(['one: unchanged', 'two: unchanged', 'three: unchanged']);
  expect(within(file).getByRole('listitem', { name: 'late: added' }).closest('details')).toBeNull();
  expect(
    within(file).getByRole('listitem', { name: 'four: unchanged' }).closest('details'),
  ).toBeNull();
});

test("the note that calls built at runtime aren't drawn shows only when the graph draws calls", async () => {
  const caveat = () => screen.queryByText('Calls whose path is built at runtime are not drawn.');
  const { unmount } = render(<ReviewPage review={pageWith(review)} />);
  await screen.findByRole('group', { name: 'rust' });
  expect(caveat()).toBeNull();
  unmount();

  render(
    <ReviewPage
      review={pageWith({
        ...review,
        diff: {
          ...review.diff,
          edges: [
            ...review.diff.edges,
            { ...dependency('domain', 'application', 'unchanged'), via: ['/api/y'] },
          ],
        },
      })}
    />,
  );
  await screen.findByRole('group', { name: 'rust' });
  expect(caveat()).not.toBeNull();
});
