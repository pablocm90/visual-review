// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { type Finding, raisedFindings } from '../core/findings.ts';
import type { Skipped } from '../core/skipped.ts';
import { findingOn, pageWith } from '../test-support/page-data.ts';
import { layoutDiff } from './layout.ts';
import {
  allEdges,
  atHash,
  crate,
  currentTab,
  expectView,
  findingInRail,
  inspector,
  noteShown,
  onScreen,
  openReview,
  partComment,
  pickKind,
  renderInFrame,
  review,
  scrolledIntoView,
  sentReview,
  showEverything,
  suggestedVerdict,
  testsShown,
  tray,
  verdict,
  viewOf,
  webFile,
  webImport,
  webModule,
  write,
  zoomShown,
} from './review-page.fixtures.tsx';
import { ReviewPage } from './review-page.tsx';

afterEach(() => history.replaceState(null, '', location.pathname));

test('draws every crate and dependency inside the rust stack with its change state, and opens no inspector until one is clicked, closing it again from its close button, which hands the keyboard focus back to the node', async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={pageWith(review)} />);

  const rust = await screen.findByRole('group', { name: 'rust' });
  expect(screen.getAllByRole('group')).toEqual([
    screen.getByRole('group', { name: 'Show' }),
    screen.getByRole('group', { name: 'Graph' }),
    rust,
  ]);
  const drawn = within(rust).getAllByRole('button');
  expect(drawn).toHaveLength(7);
  [
    'domain: unchanged',
    'application: modified',
    'cli-adapter: added',
    'legacy: removed',
    'application → domain: unchanged',
    'cli-adapter → application: added',
    'legacy → domain: removed',
  ].forEach(name => {
    expect(drawn).toContain(within(rust).getByRole('button', { name }));
  });
  expect(screen.queryByRole('complementary', { name: 'Inspector' })).toBeNull();
  expect(screen.queryByRole('region', { name: 'Summary' })).toBeNull();

  const legacy = within(rust).getByRole('button', { name: 'legacy: removed' });
  await user.click(legacy);
  expect(noteShown()).toBe('No note');
  expect(within(inspector()).getByText('crates/legacy')).not.toBeNull();
  await user.click(within(inspector()).getByRole('button', { name: 'Close inspector' }));
  expect(screen.queryByRole('complementary', { name: 'Inspector' })).toBeNull();
  expect(document.activeElement).toBe(legacy);
});

test("a part's head opens its comment field, a field per part, and an edge has its field in the column", async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={pageWith(review)} send={async () => {}} />);
  const rust = await screen.findByRole('group', { name: 'rust' });
  const field = () => within(inspector()).queryByRole('textbox', { name: 'Your comment' });

  await user.click(within(rust).getByRole('button', { name: 'domain: unchanged' }));
  expect(field()).toBeNull();
  await user.click(within(inspector()).getByRole('button', { name: 'Comment on domain' }));
  expect(field()).not.toBeNull();

  await user.click(within(rust).getByRole('button', { name: 'legacy: removed' }));
  expect(field()).toBeNull();

  await user.click(within(rust).getByRole('button', { name: 'application → domain: unchanged' }));
  expect(field()).not.toBeNull();
});

test("the column's comment field holds a comment per node or edge, kept while others are selected and the inspector closed", async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={pageWith(review)} send={async () => {}} />);
  const comment = () => within(inspector()).getByRole('textbox', { name: 'Your comment' });

  const rust = await screen.findByRole('group', { name: 'rust' });
  await user.click(within(rust).getByRole('button', { name: 'domain: unchanged' }));
  await write(user, await partComment(user), 'Keep domain free of IO.');
  await user.click(within(rust).getByRole('button', { name: 'application → domain: unchanged' }));
  expect(comment()).toHaveProperty('value', '');
  await write(user, await partComment(user), 'Why this way round?');
  await user.click(within(inspector()).getByRole('button', { name: 'Close inspector' }));

  await user.click(within(rust).getByRole('button', { name: 'domain: unchanged' }));
  expect(comment()).toHaveProperty('value', 'Keep domain free of IO.');
  await user.click(within(rust).getByRole('button', { name: 'application → domain: unchanged' }));
  expect(comment()).toHaveProperty('value', 'Why this way round?');
});

test("a served page's Review button opens the review, whose Send to Claude sends each comment on its node or its edge, then says it was sent", async () => {
  const user = userEvent.setup();
  const sent = vi.fn(async () => {});
  render(<ReviewPage review={pageWith(review)} send={sent} />);
  const reviewButton = () => screen.getByRole('button', { name: 'Review' });

  const rust = await screen.findByRole('group', { name: 'rust' });
  await user.click(within(rust).getByRole('button', { name: 'domain: unchanged' }));
  await write(user, await partComment(user), 'Keep domain free of IO.');
  await user.click(within(rust).getByRole('button', { name: 'application → domain: unchanged' }));
  await write(user, await partComment(user), 'Why this way round?');
  expect(reviewButton().getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByRole('button', { name: 'Send to Claude' })).toBeNull();
  await openReview(user);
  expect(reviewButton().getAttribute('aria-expanded')).toBe('true');
  await user.click(screen.getByRole('button', { name: 'Send to Claude' }));

  expect(sent).toHaveBeenCalledExactlyOnceWith(
    sentReview({
      comments: [
        {
          anchor: { kind: 'part', id: 'rust/crate/domain' },
          kind: 'question',
          text: 'Keep domain free of IO.',
        },
        {
          anchor: { kind: 'edge', id: 'rust/crate/application -> rust/crate/domain' },
          kind: 'question',
          text: 'Why this way round?',
        },
      ],
    }),
  );
  expect((await screen.findByRole('status', { name: 'Review' })).textContent).toBe('Sent');
  expect(screen.queryByRole('button', { name: 'Send to Claude' })).toBeNull();
});

test('each comment carries the kind picked beside it, Question until another is picked, kept per node or edge', async () => {
  const user = userEvent.setup();
  const sent = vi.fn(async () => {});
  render(<ReviewPage review={pageWith(review)} send={sent} />);
  const kind = (name: string) =>
    within(within(inspector()).getByRole('radiogroup', { name: 'Comment kind' })).getByRole(
      'radio',
      {
        name,
      },
    );

  const rust = await screen.findByRole('group', { name: 'rust' });
  await user.click(within(rust).getByRole('button', { name: 'domain: unchanged' }));
  await partComment(user);
  expect(kind('Question')).toHaveProperty('checked', true);
  await user.click(kind('Change this'));
  await write(user, await partComment(user), 'Move the IO out of domain.');
  await user.click(within(rust).getByRole('button', { name: 'application → domain: unchanged' }));
  expect(kind('Question')).toHaveProperty('checked', true);
  await user.click(kind('Suggestion'));
  await user.click(within(rust).getByRole('button', { name: 'domain: unchanged' }));
  expect(kind('Change this')).toHaveProperty('checked', true);
  await openReview(user);
  await user.click(screen.getByRole('button', { name: 'Send to Claude' }));

  expect(sent).toHaveBeenCalledExactlyOnceWith(
    sentReview({
      verdict: 'request-changes',
      comments: [
        {
          anchor: { kind: 'part', id: 'rust/crate/domain' },
          kind: 'change',
          text: 'Move the IO out of domain.',
        },
      ],
    }),
  );
});

test('the verdict follows the drafts, Approve with none or only suggestions, Comment once a question is drafted, Request changes once a change is, until one is picked, which holds as the drafts change and while the tray is closed', async () => {
  const user = userEvent.setup();
  const sent = vi.fn(async () => {});
  render(<ReviewPage review={pageWith(review)} send={sent} />);

  const rust = await screen.findByRole('group', { name: 'rust' });
  await openReview(user);
  expect(verdict('Approve')).toHaveProperty('checked', true);
  await user.click(within(rust).getByRole('button', { name: 'cli-adapter: added' }));
  await pickKind(user, 'Suggestion');
  await write(user, await partComment(user), 'A builder might read better.');
  expect(verdict('Approve')).toHaveProperty('checked', true);
  await user.click(within(rust).getByRole('button', { name: 'domain: unchanged' }));
  await write(user, await partComment(user), 'Why here?');
  expect(verdict('Comment')).toHaveProperty('checked', true);
  await user.click(within(rust).getByRole('button', { name: 'application: modified' }));
  await pickKind(user, 'Change this');
  await write(user, await partComment(user), 'Split it.');
  expect(verdict('Request changes')).toHaveProperty('checked', true);
  expect(suggestedVerdict()).toBe(verdict('Request changes'));

  await user.click(verdict('Comment'));
  await user.click(within(rust).getByRole('button', { name: 'legacy: removed' }));
  await pickKind(user, 'Change this');
  await write(user, await partComment(user), 'Keep it a release longer.');
  await openReview(user);
  expect(screen.queryByRole('radiogroup', { name: 'Verdict' })).toBeNull();
  await openReview(user);
  expect(verdict('Comment')).toHaveProperty('checked', true);
  expect(suggestedVerdict()).toBe(verdict('Request changes'));
  await user.click(screen.getByRole('button', { name: 'Send to Claude' }));

  expect(sent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ verdict: 'comment' }));
});

test('picking the verdict already suggested holds it as the drafts change', async () => {
  const user = userEvent.setup();
  const sent = vi.fn(async () => {});
  render(<ReviewPage review={pageWith(review)} send={sent} />);

  const rust = await screen.findByRole('group', { name: 'rust' });
  await openReview(user);
  await user.click(verdict('Approve'));
  await user.click(within(rust).getByRole('button', { name: 'domain: unchanged' }));
  await write(user, await partComment(user), 'Why here?');
  expect(suggestedVerdict()).toBe(verdict('Comment'));
  await user.click(screen.getByRole('button', { name: 'Send to Claude' }));

  expect(sent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ verdict: 'approve' }));
});

test('Send to Claude waits for a comment that is more than blanks, and sends no blank or cleared one', async () => {
  const user = userEvent.setup();
  const sent = vi.fn(async () => {});
  render(<ReviewPage review={pageWith(review)} send={sent} />);
  const comment = () => within(inspector()).getByRole('textbox', { name: 'Your comment' });
  const sendButton = () => screen.getByRole('button', { name: 'Send to Claude' });

  const rust = await screen.findByRole('group', { name: 'rust' });
  await openReview(user);
  await user.click(verdict('Comment'));
  expect(sendButton()).toHaveProperty('disabled', true);
  await write(user, screen.getByRole('textbox', { name: 'General comment' }), '  ');
  expect(sendButton()).toHaveProperty('disabled', true);
  await user.click(within(rust).getByRole('button', { name: 'domain: unchanged' }));
  await write(user, await partComment(user), '  ');
  expect(sendButton()).toHaveProperty('disabled', true);
  await user.click(within(rust).getByRole('button', { name: 'application → domain: unchanged' }));
  await write(user, await partComment(user), 'Why this way round?');
  await user.click(within(rust).getByRole('button', { name: 'application: modified' }));
  await write(user, await partComment(user), 'Split the crate.');
  await user.clear(comment());
  await user.click(sendButton());

  expect(sent).toHaveBeenCalledExactlyOnceWith(
    sentReview({
      comments: [
        {
          anchor: { kind: 'edge', id: 'rust/crate/application -> rust/crate/domain' },
          kind: 'question',
          text: 'Why this way round?',
        },
      ],
    }),
  );
});

test('the general comment goes with the review as its body, and alone lets a Comment be sent', async () => {
  const user = userEvent.setup();
  const sent = vi.fn(async () => {});
  render(<ReviewPage review={pageWith(review)} send={sent} />);

  await screen.findByRole('group', { name: 'rust' });
  await openReview(user);
  await user.click(verdict('Comment'));
  await user.type(
    screen.getByRole('textbox', { name: 'General comment' }),
    'Ship it once the fetch moves.',
  );
  await user.click(screen.getByRole('button', { name: 'Send to Claude' }));

  expect(sent).toHaveBeenCalledExactlyOnceWith(
    sentReview({
      body: 'Ship it once the fetch moves.',
      comments: [],
    }),
  );
});

test('an Approve can be sent with no comment', async () => {
  const user = userEvent.setup();
  const sent = vi.fn(async () => {});
  render(<ReviewPage review={pageWith(review)} send={sent} />);

  await screen.findByRole('group', { name: 'rust' });
  await openReview(user);
  await user.click(screen.getByRole('radio', { name: 'Approve' }));
  await user.click(screen.getByRole('button', { name: 'Send to Claude' }));

  expect(sent).toHaveBeenCalledExactlyOnceWith(sentReview({ verdict: 'approve' }));
});

test("a finding in the rail is answered Fix this, It's fine or Explain, only the latest pressed and sent, pressing it again withdrawing it", async () => {
  const user = userEvent.setup();
  const sent = vi.fn(async () => {});
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        findings: [
          findingOn('rust/crate/domain'),
          findingOn('rust/crate/application', { id: 'metrics:cyclomatic:rust/crate/application' }),
        ],
      })}
      send={sent}
    />,
  );
  const answer = (target: string, name: string) =>
    user.click(within(findingInRail(target)).getByRole('button', { name }));

  await screen.findByRole('group', { name: 'rust' });
  await user.click(screen.getByRole('button', { name: 'Show 2 findings' }));
  await answer('domain', 'Fix this');
  expect(
    within(findingInRail('domain')).queryByRole('textbox', { name: "Why it's fine" }),
  ).toBeNull();
  await answer('domain', 'Fix this');
  expect(within(findingInRail('domain')).queryAllByRole('button', { pressed: true })).toEqual([]);
  await answer('domain', 'Fix this');
  await answer('application', 'Explain');
  await answer('domain', "It's fine");
  expect(
    within(findingInRail('domain'))
      .getAllByRole('button', { pressed: true })
      .map(button => button.textContent),
  ).toEqual(["It's fine"]);

  await openReview(user);
  await user.click(screen.getByRole('button', { name: 'Send to Claude' }));
  expect(sent).toHaveBeenCalledExactlyOnceWith(
    sentReview({
      comments: [
        { anchor: { kind: 'finding', id: 'metrics:lines:rust/crate/domain' }, kind: 'fine' },
        {
          anchor: { kind: 'finding', id: 'metrics:cyclomatic:rust/crate/application' },
          kind: 'explain',
        },
      ],
    }),
  );
});

test('a split finding has a button per group in the rail, naming its size and going to its first part, and it takes an answer', async () => {
  const user = userEvent.setup();
  const sent = vi.fn(async () => {});
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        findings: [
          {
            id: 'cohesion:split',
            check: 'cohesion:split',
            dimension: 'cohesion',
            level: 'info',
            title: 'may be 2 independent changes',
            detail: 'Read from the graph.',
            groups: [
              ['rust/crate/application', 'rust/crate/domain', 'web'],
              ['rust/crate/domain'],
              ['rust'],
            ],
          },
        ],
      })}
      send={sent}
    />,
  );
  await screen.findByRole('group', { name: 'rust' });
  await user.click(screen.getByRole('button', { name: 'Show 1 finding' }));
  const cohesion = within(screen.getByRole('region', { name: 'Cohesion' }));

  await user.click(cohesion.getByRole('button', { name: '3 parts, from crates/application' }));
  expect(within(inspector()).getByRole('heading', { name: 'application' })).not.toBeNull();
  await user.click(cohesion.getByRole('button', { name: '1 part, from crates/domain' }));
  expect(within(inspector()).getByRole('heading', { name: 'domain' })).not.toBeNull();
  expect(cohesion.getByRole('button', { name: '1 part, from rust' })).not.toBeNull();

  await user.click(cohesion.getByRole('button', { name: 'Fix this' }));
  await openReview(user);
  await user.click(screen.getByRole('button', { name: 'Send to Claude' }));
  expect(sent).toHaveBeenCalledExactlyOnceWith(
    sentReview({
      verdict: 'request-changes',
      comments: [{ anchor: { kind: 'finding', id: 'cohesion:split' }, kind: 'fix' }],
    }),
  );
});

test("It's fine takes an optional why, which goes with the answer in the tray and to Claude unless blank", async () => {
  const user = userEvent.setup();
  const sent = vi.fn(async () => {});
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        findings: [
          findingOn('rust/crate/domain'),
          findingOn('rust/crate/application', { id: 'metrics:cyclomatic:rust/crate/application' }),
        ],
      })}
      send={sent}
    />,
  );

  await screen.findByRole('group', { name: 'rust' });
  await user.click(screen.getByRole('button', { name: 'Show 2 findings' }));
  const fine = async (target: string, why: string) => {
    await user.click(within(findingInRail(target)).getByRole('button', { name: "It's fine" }));
    await user.type(
      within(findingInRail(target)).getByRole('textbox', { name: "Why it's fine" }),
      why,
    );
  };
  await fine('domain', 'Generated code');
  await fine('application', '   ');
  await openReview(user);
  expect(
    within(within(tray()).getByRole('list', { name: 'Drafts' }))
      .getAllByRole('listitem')
      .map(item => item.textContent),
  ).toEqual(["lines 900, over 800 It's fine: Generated code", "lines 900, over 800 It's fine"]);
  await user.click(screen.getByRole('button', { name: 'Send to Claude' }));

  expect(sent).toHaveBeenCalledExactlyOnceWith(
    sentReview({
      verdict: 'approve',
      comments: [
        {
          anchor: { kind: 'finding', id: 'metrics:lines:rust/crate/domain' },
          kind: 'fine',
          text: 'Generated code',
        },
        {
          anchor: { kind: 'finding', id: 'metrics:cyclomatic:rust/crate/application' },
          kind: 'fine',
        },
      ],
    }),
  );
});

test("a finding under the inspector's note is answered there, the same answer as in the rail", async () => {
  const user = userEvent.setup();
  const sent = vi.fn(async () => {});
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        findings: [
          findingOn('rust/crate/application', { id: 'metrics:cyclomatic:rust/crate/application' }),
        ],
      })}
      send={sent}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'application: modified' }));
  await user.click(within(inspector()).getByRole('button', { name: 'Fix this' }));
  expect(
    within(inspector())
      .getAllByRole('button', { pressed: true })
      .map(button => button.textContent),
  ).toEqual(['Fix this']);
  await user.click(screen.getByRole('button', { name: 'Show 1 finding' }));
  expect(
    within(findingInRail('application'))
      .getAllByRole('button', { pressed: true })
      .map(button => button.textContent),
  ).toEqual(['Fix this']);
  await openReview(user);
  await user.click(screen.getByRole('button', { name: 'Send to Claude' }));

  expect(sent).toHaveBeenCalledExactlyOnceWith(
    sentReview({
      verdict: 'request-changes',
      comments: [
        {
          anchor: { kind: 'finding', id: 'metrics:cyclomatic:rust/crate/application' },
          kind: 'fix',
        },
      ],
    }),
  );
});

test('a page that is not served has no comment field, no answers to findings and no Review button', async () => {
  const user = userEvent.setup();
  const page = pageWith({ ...review, findings: [findingOn('rust/crate/domain')] });
  const { rerender } = render(<ReviewPage review={page} send={async () => {}} />);
  const comment = () => within(inspector()).queryByRole('textbox', { name: 'Your comment' });
  const answers = () => within(findingInRail('domain')).queryByRole('group', { name: 'Answer' });
  const noteAnswers = () => within(inspector()).queryByRole('group', { name: 'Answer' });
  const reviewButton = () => screen.queryByRole('button', { name: 'Review' });

  const rust = await screen.findByRole('group', { name: 'rust' });
  await user.click(within(rust).getByRole('button', { name: 'domain: unchanged' }));
  await user.click(screen.getByRole('button', { name: 'Show 1 finding' }));
  await partComment(user);
  expect(comment()).not.toBeNull();
  expect(answers()).not.toBeNull();
  expect(noteAnswers()).not.toBeNull();
  expect(reviewButton()).not.toBeNull();

  rerender(<ReviewPage review={page} />);
  expect(comment()).toBeNull();
  expect(answers()).toBeNull();
  expect(noteAnswers()).toBeNull();
  expect(reviewButton()).toBeNull();
});

test('a send that fails says why and leaves Send to Claude to try again', async () => {
  const user = userEvent.setup();
  const send = vi.fn(() => Promise.reject(new Error('The review was not sent: 403 Forbidden')));
  render(<ReviewPage review={pageWith(review)} send={send} />);

  const rust = await screen.findByRole('group', { name: 'rust' });
  await user.click(within(rust).getByRole('button', { name: 'domain: unchanged' }));
  await write(user, await partComment(user), 'Keep domain free of IO.');
  await openReview(user);
  await user.click(screen.getByRole('button', { name: 'Send to Claude' }));

  expect((await screen.findByRole('status', { name: 'Review' })).textContent).toBe(
    'The review was not sent: 403 Forbidden',
  );
  expect(screen.getByRole('button', { name: 'Send to Claude' })).not.toBeNull();
});

test("the review tray sits at the page's foot, its line counting the drafts and each kind among them, blank ones left out", async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={pageWith(review)} send={async () => {}} />);

  const rust = await screen.findByRole('group', { name: 'rust' });
  expect(within(tray()).getByText('Nothing drafted')).toBeDefined();
  await user.click(within(rust).getByRole('button', { name: 'domain: unchanged' }));
  await write(user, await partComment(user), 'Why here?');
  expect(within(tray()).getByText('1 drafted · 1 question')).toBeDefined();
  await user.click(within(rust).getByRole('button', { name: 'application: modified' }));
  await pickKind(user, 'Change this');
  await write(user, await partComment(user), 'Split it.');
  await user.click(within(rust).getByRole('button', { name: 'application → domain: unchanged' }));
  await write(user, await partComment(user), 'And this?');
  await user.click(within(rust).getByRole('button', { name: 'cli-adapter: added' }));
  await write(user, await partComment(user), '  ');
  expect(within(tray()).getByText('3 drafted · 1 change · 2 questions')).toBeDefined();
  expect(within(tray()).getByRole('button', { name: 'Review' })).toBeDefined();
});

test('the open tray lists the drafts, those on parts in reading order first, then the rest by id, an edge named by its ends, each going to what it is on from any tab', async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        readingOrder: { parts: ['rust/crate/legacy', 'rust/crate/application'], cycles: [] },
      })}
      send={async () => {}}
    />,
  );
  const draft = async (name: string, text: string) => {
    await user.click(
      within(screen.getByRole('group', { name: 'rust' })).getByRole('button', { name }),
    );
    await write(user, await partComment(user), text);
  };

  await screen.findByRole('group', { name: 'rust' });
  await draft('domain: unchanged', 'Why here?');
  await draft('application: modified', 'Split it.');
  await draft('application → domain: unchanged', 'And this?');
  await draft('cli-adapter: added', ' ');
  await draft('legacy: removed', 'Keep it.');
  await pickKind(user, 'Change this');
  await openReview(user);
  const drafts = within(tray()).getByRole('list', { name: 'Drafts' });
  expect(
    within(drafts)
      .getAllByRole('listitem')
      .map(item => item.textContent),
  ).toEqual([
    'legacy Change this: Keep it.',
    'application Question: Split it.',
    'application → domain Question: And this?',
    'domain Question: Why here?',
  ]);

  await user.click(screen.getByRole('link', { name: /^Tests/ }));
  await user.click(within(drafts).getByRole('button', { name: 'legacy' }));
  await waitFor(() => expect(currentTab()).toBe('Structure'));
  const legacy = await screen.findByRole('button', { name: 'legacy: removed' });
  await waitFor(() => expect(document.activeElement).toBe(legacy));
  expect(within(inspector()).getByRole('heading', { name: 'legacy' })).not.toBeNull();
});

test("the open tray lists the finding answers after the comments, each named by its finding's title and going to its target, a finding with none listed without a way there", async () => {
  const user = userEvent.setup();
  const undrawn: Finding = {
    id: 'structure:undrawn',
    check: 'structure:undrawn',
    dimension: 'structure',
    level: 'info',
    title: '1 changed file outside the graph',
    detail: 'plans/x.md',
  };
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        findings: [
          findingOn('rust/crate/domain'),
          findingOn('rust/crate/application', {
            id: 'metrics:cyclomatic:rust/crate/application',
            title: 'cyclomatic 30, over 20',
          }),
          undrawn,
        ],
      })}
      send={async () => {}}
    />,
  );
  const rail = () => screen.getByRole('complementary', { name: 'Findings' });
  const inRail = (title: string) => within(within(rail()).getByText(title).closest('li') ?? rail());
  const answer = (title: string, name: string) =>
    user.click(inRail(title).getByRole('button', { name }));

  const rust = await screen.findByRole('group', { name: 'rust' });
  await user.click(within(rust).getByRole('button', { name: 'domain: unchanged' }));
  await write(user, await partComment(user), 'Why here?');
  await user.click(screen.getByRole('button', { name: 'Show 3 findings' }));
  await answer('cyclomatic 30, over 20', 'Explain');
  await answer('lines 900, over 800', "It's fine");
  await write(
    user,
    inRail('lines 900, over 800').getByRole('textbox', { name: "Why it's fine" }),
    'Generated',
  );
  await answer(undrawn.title, 'Fix this');
  await openReview(user);
  const drafts = within(tray()).getByRole('list', { name: 'Drafts' });
  expect(
    within(drafts)
      .getAllByRole('listitem')
      .map(item => item.textContent),
  ).toEqual([
    'domain Question: Why here?',
    'cyclomatic 30, over 20 Explain',
    "lines 900, over 800 It's fine: Generated",
    '1 changed file outside the graph Fix this',
  ]);
  expect(
    within(drafts)
      .getAllByRole('button')
      .map(button => button.textContent),
  ).toEqual(['domain', 'cyclomatic 30, over 20', 'lines 900, over 800']);

  await user.click(screen.getByRole('link', { name: /^Tests/ }));
  await user.click(within(drafts).getByRole('button', { name: 'cyclomatic 30, over 20' }));
  await waitFor(() => expect(currentTab()).toBe('Structure'));
  expect(within(inspector()).getByRole('heading', { name: 'application' })).not.toBeNull();
});

test('in a frame half the graph wide and a tall window, the graph opens no smaller than 80%, centred and panned into its middle, in a frame as high as the graph at that scale', async () => {
  const graph = await layoutDiff(review.diff);
  renderInFrame(pageWith(review), { width: graph.width / 2, windowHeight: 10_000 });

  const frame = await screen.findByRole('group', { name: 'Graph' });
  const rust = await within(frame).findByRole('group', { name: 'rust' });
  expect(zoomShown()).toBe('80%');
  expectView(rust, graph.width / 4 - (graph.width / 2) * 0.8, 0, 0.8);
  expect(Number.parseFloat(frame.style.height)).toBeCloseTo(graph.height * 0.8, 6);
});

test('in a frame twice the graph wide and a window half the graph high, the graph opens at 80%, centred across and panned into its middle down a frame as high as the window allows', async () => {
  const graph = await layoutDiff(review.diff);
  renderInFrame(pageWith(review), { width: graph.width * 2, windowHeight: graph.height / 2 + 48 });

  const frame = await screen.findByRole('group', { name: 'Graph' });
  const rust = await within(frame).findByRole('group', { name: 'rust' });
  expect(zoomShown()).toBe('80%');
  expectView(
    rust,
    (graph.width * 2 - graph.width * 0.8) / 2,
    graph.height / 4 - (graph.height / 2) * 0.8,
    0.8,
  );
  expect(Number.parseFloat(frame.style.height)).toBeCloseTo(graph.height / 2, 6);
});

test('the toolbar zooms the graph by steps of 1.25, to 100% about the frame centre and back to fitted, and a relayout refits', async () => {
  const user = userEvent.setup();
  const graph = await layoutDiff(review.diff);
  renderInFrame(pageWith(review), {
    width: graph.width / 2,
    windowHeight: graph.height / 2 + 48,
  });
  const rust = await screen.findByRole('group', { name: 'rust' });
  const press = (name: string) => user.click(screen.getByRole('button', { name }));

  await press('Zoom in');
  expect(zoomShown()).toBe('100%');
  await press('Zoom out');
  expect(zoomShown()).toBe('80%');
  await press('Actual size');
  expect(zoomShown()).toBe('100%');
  expectView(rust, -graph.width / 4, -graph.height / 4, 1);
  await press('Fit');
  expect(zoomShown()).toBe('80%');
  expectView(rust, -graph.width * 0.15, -graph.height * 0.15, 0.8);

  await press('Zoom in');
  expect(zoomShown()).toBe('100%');
  await showEverything(user);
  await waitFor(() => expect(zoomShown()).toBe('80%'));
});

test('dragging from a node pans the graph and selects nothing, even back near where it began, while a press that barely moves still selects it', async () => {
  const user = userEvent.setup();
  const graph = await layoutDiff(review.diff);
  renderInFrame(pageWith(review), {
    width: graph.width / 2,
    windowHeight: graph.height / 2 + 48,
  });
  const rust = await screen.findByRole('group', { name: 'rust' });
  await user.click(screen.getByRole('button', { name: 'Actual size' }));
  const domain = within(rust).getByRole('button', { name: 'domain: unchanged' });
  const drag = (...moves: ReadonlyArray<{ readonly clientX: number; readonly clientY: number }>) =>
    user.pointer([
      { keys: '[MouseLeft>]', target: domain, coords: { clientX: 100, clientY: 100 } },
      ...moves.map(coords => ({ coords })),
      { keys: '[/MouseLeft]' },
    ]);
  const pannedBy = (x: number, y: number) =>
    expectView(rust, x - graph.width / 4, y - graph.height / 4, 1);

  await drag({ clientX: 140, clientY: 130 });
  pannedBy(40, 30);
  await drag({ clientX: 140, clientY: 130 }, { clientX: 102, clientY: 101 });
  pannedBy(42, 31);
  expect(screen.queryByRole('complementary', { name: 'Inspector' })).toBeNull();

  await drag({ clientX: 103, clientY: 100 });
  pannedBy(42, 31);
  expect(noteShown()).toBe('No note');

  await drag({ clientX: 140, clientY: 130 });
  screen.getByRole('button', { name: 'Zoom in' }).focus();
  await user.keyboard('{Enter}');
  expect(zoomShown()).toBe('125%');
  const panned = viewOf(rust);

  for (const button of ['MouseRight', 'MouseMiddle']) {
    await user.pointer([
      { keys: `[${button}>]`, target: domain, coords: { clientX: 100, clientY: 100 } },
      { coords: { clientX: 140, clientY: 130 } },
      { keys: `[/${button}]` },
    ]);
    expect(viewOf(rust)).toBe(panned);
  }

  fireEvent.pointerDown(domain, { button: 0, clientX: 100, clientY: 100 });
  fireEvent.pointerCancel(window);
  fireEvent.pointerMove(window, { clientX: 140, clientY: 130 });
  expect(viewOf(rust)).toBe(panned);
});

test('the wheel pans the graph, scrolling the page instead once the graph can move no further that way, and with Ctrl or ⌘ zooms it at the pointer', async () => {
  const graph = await layoutDiff(review.diff);
  renderInFrame(pageWith(review), { width: graph.width / 2, windowHeight: 10_000 });
  const rust = await screen.findByRole('group', { name: 'rust' });
  const frame = screen.getByRole('group', { name: 'Graph' });
  vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue(
    DOMRect.fromRect({ x: 10, y: 20, width: graph.width / 2, height: graph.height / 2 }),
  );

  expect(fireEvent.wheel(frame, { ctrlKey: true, deltaY: 100 })).toBe(false);
  expect(zoomShown()).toBe('50%');
  expect(fireEvent.wheel(frame, { ctrlKey: true, deltaY: -100, clientX: 10, clientY: 20 })).toBe(
    false,
  );
  expect(zoomShown()).toBe('100%');
  expect(viewOf(rust)).toBe('translate(0 0) scale(1)');
  expect(fireEvent.wheel(frame, { deltaX: -30, deltaY: -20 })).toBe(true);
  expect(fireEvent.wheel(frame, { deltaX: -30, deltaY: 20 })).toBe(false);
  expect(viewOf(rust)).toBe('translate(0 -20) scale(1)');
  expect(fireEvent.wheel(frame, { deltaX: 30, deltaY: -20 })).toBe(false);
  expect(viewOf(rust)).toBe('translate(-30 0) scale(1)');
  expect(fireEvent.wheel(frame, { deltaX: 30, deltaY: -20 })).toBe(false);
  expect(viewOf(rust)).toBe('translate(-60 0) scale(1)');
  expect(fireEvent.wheel(frame, { metaKey: true, deltaY: 50 })).toBe(false);
  expect(zoomShown()).toBe('71%');
});

test('with the frame focused, + = - step the zoom, 1 goes to 100%, 0 fits, and the arrows pan by 40px without scrolling the page', async () => {
  const user = userEvent.setup();
  const graph = await layoutDiff(review.diff);
  renderInFrame(pageWith(review), {
    width: graph.width / 2,
    windowHeight: graph.height / 2 + 48,
  });
  const rust = await screen.findByRole('group', { name: 'rust' });
  const frame = screen.getByRole('group', { name: 'Graph' });
  const at100 = (x: number, y: number) =>
    expectView(rust, x - graph.width / 4, y - graph.height / 4, 1);
  frame.focus();

  await user.keyboard('+');
  expect(zoomShown()).toBe('100%');
  await user.keyboard('=');
  expect(zoomShown()).toBe('125%');
  await user.keyboard('-');
  expect(zoomShown()).toBe('100%');
  await user.keyboard('1');
  at100(0, 0);
  await user.keyboard('{ArrowRight}');
  at100(-40, 0);
  await user.keyboard('{ArrowDown}');
  at100(-40, -40);
  await user.keyboard('{ArrowLeft}{ArrowLeft}');
  at100(40, -40);
  await user.keyboard('{ArrowUp}{ArrowUp}');
  at100(40, 40);
  expect(fireEvent.keyDown(frame, { key: 'ArrowUp' })).toBe(false);
  expect(fireEvent.keyDown(frame, { key: 'Tab' })).toBe(true);
  expect(fireEvent.keyDown(frame, { key: '=', ctrlKey: true })).toBe(true);
  expect(fireEvent.keyDown(frame, { key: '-', metaKey: true })).toBe(true);
  expect(fireEvent.keyDown(frame, { key: 'ArrowLeft', altKey: true })).toBe(true);
  at100(40, 80);
  await user.keyboard('0');
  expectView(rust, -graph.width * 0.15, -graph.height * 0.15, 0.8);
});

test("resizing the frame keeps the zoom and the graph point at the frame's centre", async () => {
  const user = userEvent.setup();
  const graph = await layoutDiff(review.diff);
  const { resize } = renderInFrame(pageWith(review), {
    width: graph.width / 2,
    windowHeight: 10_000,
  });
  const rust = await screen.findByRole('group', { name: 'rust' });
  await user.click(screen.getByRole('button', { name: 'Actual size' }));

  resize((graph.width * 3) / 4);
  expect(zoomShown()).toBe('100%');
  expectView(rust, -graph.width / 8, -graph.height / 10, 1);
});

test("toggling a box keeps the zoom and the box's corner where it was on screen, and a checkbox change then refits", async () => {
  const user = userEvent.setup();
  renderInFrame(
    pageWith({
      range: 'abc123..def456',
      diff: {
        nodes: [
          { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
          webModule('app'),
          webModule('utils', 'modified'),
          webFile('app', 'main.ts'),
          webFile('utils', 'x.ts', 'modified'),
          webFile('utils', 'y.ts'),
        ],
        edges: [webImport('app/main.ts', 'utils/x.ts', 'added')],
      },
    }),
    { width: 200, windowHeight: 10_000 },
  );
  const web = await screen.findByRole('group', { name: 'web' });
  const press = (name: string) => user.click(screen.getByRole('button', { name }));
  await press('Actual size');
  fireEvent.wheel(screen.getByRole('group', { name: 'Graph' }), {
    ctrlKey: true,
    deltaY: -100,
    clientX: 100,
    clientY: 50,
  });
  expect(zoomShown()).toBe('200%');
  const before = onScreen(within(web).getByRole('button', { name: 'Expand utils' }));

  await press('Expand utils');

  await within(web).findByRole('group', { name: 'utils' });
  const collapse = within(web).getByRole('button', { name: 'Collapse utils' });
  expect(zoomShown()).toBe('200%');
  expect(onScreen(collapse).x).toBeCloseTo(before.x);
  expect(onScreen(collapse).y).toBeCloseTo(before.y);

  const refitsFrom = async (zoom: string) => {
    await waitFor(() => expect(zoomShown()).not.toBe(zoom));
    const refitted = viewOf(web);
    await press('Fit');
    expect(viewOf(web)).toBe(refitted);
  };
  const collapseUtilsAt125 = async () => {
    await press('Actual size');
    await press('Zoom in');
    await press('Collapse utils');
    await waitFor(() => expect(within(web).queryByRole('group', { name: 'utils' })).toBeNull());
    expect(zoomShown()).toBe('125%');
  };
  await collapseUtilsAt125();
  await showEverything(user);
  await refitsFrom('125%');

  await press('Expand utils');
  await within(web).findByRole('group', { name: 'utils' });
  await collapseUtilsAt125();
  await user.click(await allEdges(user));
  await refitsFrom('125%');
});

test('going to a hidden file from the summary opens its module and lands it centred in the frame at 100%, focused, with the frame scrolled into view', async () => {
  const user = userEvent.setup();
  renderInFrame(
    pageWith({
      range: 'abc123..def456',
      diff: {
        nodes: [
          { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
          webModule('app'),
          webModule('utils', 'modified'),
          webFile('app', 'main.ts'),
          webFile('utils', 'x.ts', 'modified'),
          webFile('utils', 'y.ts'),
          webFile('utils', 'z.ts'),
        ],
        edges: [webImport('app/main.ts', 'utils/x.ts', 'added')],
      },
    }),
    {
      width: 120,
      windowHeight: 108,
      notes: {
        version: 2,
        tests: '',
        summary: [{ text: 'Check y.ts', target: 'web/file/utils/y.ts' }],
        notes: {},
      },
    },
  );
  await screen.findByRole('group', { name: 'web' });

  await user.click(screen.getByRole('button', { name: 'Check y.ts' }));

  const y = await screen.findByRole('button', { name: 'y.ts: unchanged' });
  await waitFor(() => expect(document.activeElement).toBe(y));
  const frame = screen.getByRole('group', { name: 'Graph' });
  const box = y.querySelector('rect');
  const centre = onScreen(y, {
    x: Number(box?.getAttribute('width')) / 2,
    y: Number(box?.getAttribute('height')) / 2,
  });
  expect(zoomShown()).toBe('100%');
  expect(centre.x).toBeCloseTo(60);
  expect(centre.y).toBeCloseTo(parseFloat(frame.style.height) / 2);
  expect(scrolledIntoView.mock.contexts).toContain(frame);
});

test("a PR's page is headed by the PR's number and title, as a link to it", async () => {
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        pullRequest: {
          number: 7,
          title: 'Add the cli crate',
          url: 'https://github.com/acme/shop/pull/7',
        },
      })}
    />,
  );

  expect(
    within(screen.getByRole('heading', { level: 1 })).getByRole('link', {
      name: '#7 Add the cli crate',
    }),
  ).toHaveProperty('href', 'https://github.com/acme/shop/pull/7');
  await screen.findByRole('group', { name: 'rust' });
});

test('the Review nav links Structure and Tests, and marks Structure the current page', async () => {
  render(<ReviewPage review={pageWith(review)} />);

  const links = within(screen.getByRole('navigation', { name: 'Review' })).getAllByRole('link');
  expect(links.map(link => link.textContent)).toEqual(['Structure', 'Tests']);
  expect(links[0]?.getAttribute('href')).toBe('#structure');
  expect(links[0]?.getAttribute('aria-current')).toBe('page');
  await screen.findByRole('group', { name: 'rust' });
});

test.for([
  { hash: '#tests', tab: 'Tests' },
  { hash: '#metrics', tab: 'Structure' },
  { hash: '#elsewhere', tab: 'Structure' },
])('at $hash the page opens on $tab', ({ hash, tab }) => {
  atHash(hash);
  render(<ReviewPage review={pageWith(review)} />);

  expect(currentTab()).toBe(tab);
  expect(screen.queryByRole('group', { name: 'Show' }) !== null).toBe(tab === 'Structure');
});

test("the Tests tab's link counts the review's changed tests, a moved pair once, and carries no count with none changed", async () => {
  const user = userEvent.setup();
  const { rerender } = render(
    <ReviewPage
      review={pageWith({
        ...review,
        tests: [
          {
            path: 'crates/application/src/lib.rs',
            stack: 'rust',
            statements: [
              { kind: 'test', name: 'reads the notes', change: 'edited' },
              {
                kind: 'test',
                name: 'exports a CSV',
                change: 'removed',
                movedTo: 'crates/domain/src/lib.rs',
              },
            ],
          },
          {
            path: 'crates/domain/src/lib.rs',
            stack: 'rust',
            statements: [
              {
                kind: 'test',
                name: 'exports a CSV',
                change: 'added',
                movedFrom: 'crates/application/src/lib.rs',
              },
            ],
          },
        ],
      })}
    />,
  );

  expect(
    within(screen.getByRole('navigation', { name: 'Review' }))
      .getAllByRole('link')
      .map(link => link.textContent),
  ).toEqual(['Structure', 'Tests 2']);
  await user.click(screen.getByRole('link', { name: 'Tests 2' }));
  await waitFor(() => expect(currentTab()).toBe('Tests 2'));
  expect(screen.queryByRole('group', { name: 'rust' })).toBeNull();
  rerender(<ReviewPage review={pageWith(review)} />);
  expect(screen.getByRole('link', { name: 'Tests' })).not.toBeNull();
});

test("the Tests tab heads the test changes with what the notes say they pin, and lists each changed test file with its stack's label, marking a new one and what a renamed one was; with no notes and no test changed, it says so", () => {
  atHash('#tests');
  const added = [{ kind: 'test' as const, name: 'reads the notes', change: 'added' as const }];
  const { rerender } = render(
    <ReviewPage
      review={pageWith({
        ...review,
        diff: {
          ...review.diff,
          nodes: [
            ...review.diff.nodes,
            { id: 'web', kind: 'stack', label: 'Web app', path: '', state: 'unchanged' },
          ],
        },
        tests: [
          {
            path: 'crates/application/tests/export.rs',
            stack: 'rust',
            new: true,
            statements: added,
          },
          {
            path: 'web/src/notes.test.ts',
            stack: 'web',
            renamedFrom: 'web/src/note.test.ts',
            statements: added,
          },
          { path: 'tools/review/x.test.ts', stack: 'tools/review', statements: added },
        ],
      })}
      notes={{ version: 2, summary: [], tests: 'The export is pinned.', notes: {} }}
    />,
  );

  expect(
    within(screen.getByRole('region', { name: 'What they pin' })).getByText(
      'The export is pinned.',
    ),
  ).not.toBeNull();
  expect(testsShown()).toEqual([
    'crates/application/tests/export.rs',
    'web/src/notes.test.ts',
    'tools/review/x.test.ts',
  ]);
  const exported = screen.getByRole('region', { name: 'crates/application/tests/export.rs' });
  expect(within(exported).getByText('rust')).not.toBeNull();
  expect(within(exported).getByText('new file')).not.toBeNull();
  const notesTest = screen.getByRole('region', { name: 'web/src/notes.test.ts' });
  expect(within(notesTest).getByText('Web app')).not.toBeNull();
  expect(within(notesTest).getByText('renamed from web/src/note.test.ts')).not.toBeNull();
  expect(within(notesTest).queryByText('new file')).toBeNull();
  const undrawn = screen.getByRole('region', { name: 'tools/review/x.test.ts' });
  expect(within(undrawn).getByText('tools/review')).not.toBeNull();

  rerender(<ReviewPage review={pageWith(review)} />);
  expect(screen.queryByRole('region', { name: 'What they pin' })).toBeNull();
  expect(testsShown()).toEqual([]);
  expect(
    within(screen.getByRole('region', { name: 'Test changes' })).getByText('No test changed.'),
  ).not.toBeNull();
});

test('the Tests tab shows all the test changes by default, or, while a node is picked on Structure, those alongside it, saying so when none changed there; with the pick cleared it shows them all', async () => {
  const user = userEvent.setup();
  const added = (name: string) => ({ kind: 'test' as const, name, change: 'added' as const });
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        tests: [
          {
            path: 'crates/application/src/lib.rs',
            stack: 'rust',
            statements: [added('reads the notes')],
          },
          {
            path: 'crates/application/tests/export.rs',
            stack: 'rust',
            statements: [added('exports a CSV'), added('names the columns')],
          },
          {
            path: 'crates/cli-adapter/src/main.rs',
            stack: 'rust',
            statements: [added('parses the args')],
          },
        ],
      })}
    />,
  );
  const shownBy = (name: string) =>
    within(screen.getByRole('group', { name: 'Tests shown' })).getByRole('button', { name });
  const goTo = (tab: string) =>
    user.click(
      within(screen.getByRole('navigation', { name: 'Review' })).getByRole('link', {
        name: new RegExp(`^${tab}`),
      }),
    );

  await user.click(await screen.findByRole('button', { name: 'application: modified' }));
  await goTo('Tests');
  expect(shownBy('All 4').getAttribute('aria-pressed')).toBe('true');
  expect(shownBy('For application 3').getAttribute('aria-pressed')).toBe('false');
  expect(testsShown()).toHaveLength(3);
  await user.click(shownBy('For application 3'));
  expect(shownBy('For application 3').getAttribute('aria-pressed')).toBe('true');
  expect(shownBy('All 4').getAttribute('aria-pressed')).toBe('false');
  expect(testsShown()).toEqual([
    'crates/application/src/lib.rs',
    'crates/application/tests/export.rs',
  ]);

  await goTo('Structure');
  await user.click(await screen.findByRole('button', { name: 'domain: unchanged' }));
  await goTo('Tests');
  await user.click(shownBy('For domain 0'));
  expect(testsShown()).toEqual([]);
  expect(
    within(screen.getByRole('region', { name: 'Test changes' })).getByText('No test changed here.'),
  ).not.toBeNull();
  await user.click(shownBy('All 4'));
  expect(testsShown()).toHaveLength(3);

  await goTo('Structure');
  await user.click(within(inspector()).getByRole('button', { name: 'Close inspector' }));
  await goTo('Tests');
  expect(
    within(screen.getByRole('group', { name: 'Tests shown' }))
      .getAllByRole('button')
      .map(button => `${button.textContent} ${button.getAttribute('aria-pressed')}`),
  ).toEqual(['All 4 true']);
});

test('the Tests tab counts the shown tests by change, a moved pair once, as moved, even with only one of its files shown', async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        tests: [
          {
            path: 'crates/application/src/lib.rs',
            stack: 'rust',
            statements: [
              { kind: 'test', name: 'reads the notes', change: 'edited' },
              { kind: 'test', name: 'quotes commas', change: 'added' },
              {
                kind: 'test',
                name: 'exports a CSV',
                change: 'removed',
                movedTo: 'crates/domain/src/lib.rs',
              },
            ],
          },
          {
            path: 'crates/domain/src/lib.rs',
            stack: 'rust',
            statements: [
              { kind: 'test', name: 'drops the totals', change: 'removed' },
              {
                kind: 'test',
                name: 'exports a CSV',
                change: 'added',
                movedFrom: 'crates/application/src/lib.rs',
              },
            ],
          },
        ],
      })}
    />,
  );
  const counts = () =>
    within(screen.getByRole('list', { name: 'Changed tests' }))
      .getAllByRole('listitem')
      .map(count => `${count.textContent} ${count.getAttribute('aria-label')}`);

  await user.click(await screen.findByRole('button', { name: 'domain: unchanged' }));
  await user.click(screen.getByRole('link', { name: 'Tests 4' }));
  expect(counts()).toEqual(['+1 1 added', '✎1 1 edited', '−1 1 removed', '↷1 1 moved']);
  await user.click(screen.getByRole('button', { name: 'For domain 2' }));
  expect(counts()).toEqual(['+0 0 added', '✎0 0 edited', '−1 1 removed', '↷1 1 moved']);
});

test("the Tests tab lists the added and modified nodes, not stacks, with the changed tests alongside each, those with none first, marked as needing a look; a node's name goes to it on Structure, focused, its inspector open", async () => {
  atHash('#tests');
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        diff: {
          ...review.diff,
          nodes: [
            { id: 'rust', kind: 'stack', label: 'rust', path: '', state: 'modified' },
            crate('domain', 'unchanged'),
            crate('application', 'modified'),
            crate('cli-adapter', 'added'),
            crate('legacy', 'removed'),
            crate('billing', 'modified'),
          ],
        },
        tests: [
          {
            path: 'crates/application/tests/export.rs',
            stack: 'rust',
            statements: [
              { kind: 'test', name: 'exports a CSV', change: 'added' },
              { kind: 'test', name: 'names the columns', change: 'edited' },
              { kind: 'test', name: 'quotes commas', change: 'unchanged' },
            ],
          },
          {
            path: 'crates/legacy/tests/export.rs',
            stack: 'rust',
            statements: [{ kind: 'test', name: 'exports a CSV', change: 'removed' }],
          },
        ],
      })}
    />,
  );

  expect(
    within(screen.getByRole('region', { name: 'Changed nodes' }))
      .getAllByRole('listitem')
      .map(node =>
        [
          node.getAttribute('aria-label'),
          ...within(node)
            .queryAllByRole('img')
            .map(mark => mark.getAttribute('aria-label')),
        ].join(', '),
      ),
  ).toEqual([
    'cli-adapter: added, tests alongside: none, needs a look',
    'billing: modified, tests alongside: none, needs a look',
    'application: modified, tests alongside: 2',
  ]);

  await user.click(
    within(screen.getByRole('region', { name: 'Changed nodes' })).getByRole('button', {
      name: 'billing',
    }),
  );
  await waitFor(() => expect(currentTab()).toBe('Structure'));
  const billing = await screen.findByRole('button', { name: 'billing: modified' });
  await waitFor(() => expect(document.activeElement).toBe(billing));
  expect(within(inspector()).getByRole('heading', { name: 'billing' })).not.toBeNull();
});

test('picking a tab sets the hash and shows it, and back and forward move between the tabs', async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={pageWith(review)} />);
  await screen.findByRole('group', { name: 'rust' });

  await user.click(screen.getByRole('link', { name: 'Tests' }));
  await waitFor(() => expect(currentTab()).toBe('Tests'));
  expect(location.hash).toBe('#tests');
  expect(screen.queryByRole('group', { name: 'rust' })).toBeNull();

  history.back();
  await waitFor(() => expect(currentTab()).toBe('Structure'));
  history.forward();
  await waitFor(() => expect(currentTab()).toBe('Tests'));
  location.hash = '#structure';
  await waitFor(() => expect(currentTab()).toBe('Structure'));
});

test('a reader skipped for want of its tool is named once, at the top of the findings rail, collapsed or open, with the stacks it did not read', async () => {
  const user = userEvent.setup();
  const skipped: ReadonlyArray<Skipped> = [
    { reader: 'rust', stacks: ['rust', 'rust~2'], reason: 'cargo not found on PATH' },
  ];
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        skipped,
        findings: raisedFindings({
          skipped,
          changedPaths: [],
          patches: [],
          undrawn: [],
          danglingCalls: [],
          dependencyChanges: [],
          migrations: [],
          schemas: [],
          routes: [],
          access: [],
          openActions: [],
          metricFindings: [],
          symbols: [],
          symbolsNotRead: [],
          reaches: [],
          tests: [],
          nodes: [],
          split: undefined,
          ruleBreaks: [],
          edges: [],
          deployKeysAtBase: [],
          deployConfig: {},
        }),
      })}
    />,
  );

  const line = 'rust, rust~2 not read: cargo not found on PATH';
  const collapsed = await screen.findByRole('navigation', { name: 'Findings' });
  expect(within(within(collapsed).getByRole('alert')).getByText(line)).toBeDefined();
  await user.click(within(collapsed).getByRole('button', { name: 'Show 0 findings' }));
  const open = screen.getByRole('complementary', { name: 'Findings' });
  expect(within(open).getByRole('alert').textContent).toBe(line);
  expect(within(open).getAllByText(line)).toHaveLength(1);
  expect(screen.getAllByRole('alert')).toHaveLength(1);
});

test('the findings rail hands the keyboard focus to its other toggle as it opens and hides, and takes none as the page opens or while a node is picked with the rail open', async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={pageWith(review)} />);
  const show = await screen.findByRole('button', { name: 'Show 0 findings' });
  expect(document.activeElement).toBe(document.body);

  show.focus();
  await user.keyboard('{Enter}');
  const hide = screen.getByRole('button', { name: 'Hide findings' });
  expect(document.activeElement).toBe(hide);

  const domain = await screen.findByRole('button', { name: 'domain: unchanged' });
  await user.click(domain);
  expect(document.activeElement).toBe(domain);

  hide.focus();
  await user.keyboard('{Enter}');
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Show 0 findings' }));
});

test.for([
  {
    range: '646f56cfd31dbe78c3b93e793c174efe85d8f666..fe2b80f6d56a89db7649e4e59a7b73790e5f8202',
    heading: '646f56c..fe2b80f',
    graph: 'Structure 646f56c..fe2b80f',
  },
  { range: 'main..my-branch', heading: 'main..my-branch', graph: 'Structure main..my-branch' },
  { range: 'HEAD..worktree', heading: 'Uncommitted work', graph: 'Structure HEAD..worktree' },
])(
  'a page with no PR is headed by $range, by short SHAs, and so is its graph',
  async ({ range, heading, graph }) => {
    render(<ReviewPage review={pageWith({ ...review, range })} />);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(heading);
    await screen.findByRole('group', { name: 'rust' });
    expect(screen.getByTitle(graph).tagName).toBe('title');
  },
);

test("a short SHA in the header's range shows its full SHA on hover", async () => {
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        pullRequest: {
          number: 7,
          title: 'Add the cli crate',
          url: 'https://github.com/acme/shop/pull/7',
        },
        range: '646f56cfd31dbe78c3b93e793c174efe85d8f666..fe2b80f6d56a89db7649e4e59a7b73790e5f8202',
      })}
    />,
  );

  expect(screen.getByTitle('646f56cfd31dbe78c3b93e793c174efe85d8f666').textContent).toBe('646f56c');
  expect(screen.getByTitle('fe2b80f6d56a89db7649e4e59a7b73790e5f8202').textContent).toBe('fe2b80f');
  await screen.findByRole('group', { name: 'rust' });
});

test('clicking a crate or a dependency, or pressing Enter or Space on it, shows its note, a crate without one says so, and a flagged one is named with its flag', async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        ...review,
      })}
      notes={{
        version: 2,
        tests: '',
        summary: [],
        notes: {
          'part rust/crate/application': { text: 'Adds the export use case.' },
          'part rust/crate/cli-adapter': { text: 'A second way in.', flag: 'new entry point' },
          'edge rust/crate/cli-adapter -> rust/crate/application': {
            text: 'The CLI drives the use case.',
            flag: 'new dependency direction',
          },
        },
      }}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'application: modified' }));
  expect(noteShown()).toBe('Adds the export use case.');

  await user.click(
    screen.getByRole('button', {
      name: 'cli-adapter → application: added, flagged: new dependency direction',
    }),
  );
  expect(noteShown()).toBe('The CLI drives the use case.');

  await user.click(
    screen.getByRole('button', { name: 'cli-adapter: added, flagged: new entry point' }),
  );
  expect(noteShown()).toBe('A second way in.');

  await user.click(screen.getByRole('button', { name: 'domain: unchanged' }));
  expect(noteShown()).toBe('No note');

  screen.getByRole('button', { name: 'application: modified' }).focus();
  await user.keyboard('a');
  expect(noteShown()).toBe('No note');
  await user.keyboard('{Enter}');
  expect(noteShown()).toBe('Adds the export use case.');

  screen
    .getByRole('button', {
      name: 'cli-adapter → application: added, flagged: new dependency direction',
    })
    .focus();
  await user.keyboard(' ');
  expect(noteShown()).toBe('The CLI drives the use case.');
});
