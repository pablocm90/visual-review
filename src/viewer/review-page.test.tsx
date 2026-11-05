// @vitest-environment jsdom
import { act, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, onTestFinished, test, vi } from 'vitest';
import type { GraphDiff } from '../core/diff-graphs.ts';
import { type Finding, raisedFindings } from '../core/findings.ts';
import type { ReviewNotes } from '../core/notes.ts';
import type { PageData } from '../core/page.ts';
import type { PreviousComment } from '../core/previous-comments.ts';
import type { Commit, SymbolFile } from '../core/read-range.ts';
import type { Comment, Review } from '../core/review.ts';
import type { ChangedSince, SinceReview } from '../core/since-review.ts';
import type { Skipped } from '../core/skipped.ts';
import type { KindOfChange, SymbolStatement } from '../core/symbol-changes.ts';
import { symbolFindings } from '../core/symbol-findings.ts';
import { findingOn, measured, pageWith } from '../test-support/page-data.ts';
import { layoutDiff } from './layout.ts';
import { ReviewPage } from './review-page.tsx';

const frameOfWidth = (width: number) => {
  const observing: { report?: (width: number) => void } = {};
  const Observer = class implements ResizeObserver {
    readonly #report: ResizeObserverCallback;
    constructor(report: ResizeObserverCallback) {
      this.#report = report;
    }
    observe(target: Element) {
      observing.report = (width: number) =>
        this.#report(
          [
            {
              target,
              contentRect: DOMRectReadOnly.fromRect({ width }),
              borderBoxSize: [],
              contentBoxSize: [],
              devicePixelContentBoxSize: [],
            },
          ],
          this,
        );
      observing.report(width);
    }
    unobserve() {}
    disconnect() {}
  };
  return { Observer, resize: (to: number) => act(() => observing.report?.(to)) };
};

const WIDE_FRAME = 1200;

vi.stubGlobal('ResizeObserver', frameOfWidth(WIDE_FRAME).Observer);

const scrolledIntoView = vi.fn();

Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: scrolledIntoView });

vi.stubGlobal('scrollTo', vi.fn());

type Diffed = GraphDiff['nodes'][number]['state'];

const crate = (name: string, state: Diffed) => ({
  id: `rust/crate/${name}`,
  kind: 'package' as const,
  label: name,
  parent: 'rust',
  path: `crates/${name}`,
  state,
});

const dependency = (from: string, to: string, state: GraphDiff['edges'][number]['state']) => ({
  from: `rust/crate/${from}`,
  to: `rust/crate/${to}`,
  state,
});

const review = {
  range: 'abc123..def456',
  diff: {
    nodes: [
      { id: 'rust', kind: 'stack' as const, label: 'rust', path: '', state: 'unchanged' as const },
      crate('domain', 'unchanged'),
      crate('application', 'modified'),
      crate('cli-adapter', 'added'),
      crate('legacy', 'removed'),
    ],
    edges: [
      dependency('application', 'domain', 'unchanged'),
      dependency('cli-adapter', 'application', 'added'),
      dependency('legacy', 'domain', 'removed'),
    ],
  },
};

configure({ asyncUtilTimeout: 3000 });

await layoutDiff(review.diff);

afterEach(() => history.replaceState(null, '', location.pathname));

const shown = (name: string) =>
  within(screen.getByRole('group', { name: 'Show' })).getByRole('button', { name });

const showEverything = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(shown('Everything'));

const openReview = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'Review' }));

const write = async (user: ReturnType<typeof userEvent.setup>, box: HTMLElement, text: string) => {
  await user.click(box);
  await user.paste(text);
};

const sentReview = (sent: Partial<Review>): Review => ({
  version: 6,
  verdict: 'comment',
  reviewed: { range: review.range },
  read: [],
  resolved: [],
  comments: [],
  ...sent,
});

const inspector = () => screen.getByRole('complementary', { name: 'Inspector' });

const noteTab = () => screen.getByRole('tabpanel', { name: 'Note' });

const noteShown = () => within(noteTab()).getAllByRole('paragraph')[0]?.textContent;

const inspectorTabs = () =>
  within(inspector())
    .queryAllByRole('tab')
    .map(tab => tab.textContent);

const findingsShown = () =>
  within(noteTab())
    .queryAllByRole('listitem')
    .map(item => item.textContent);

test('draws every crate and dependency inside the rust stack with its change state, and opens no inspector until one is clicked, closing it again from its close button, which hands the keyboard focus back to the node', async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={pageWith(review)} />);

  const rust = await screen.findByRole('group', { name: 'rust' });
  expect(screen.getAllByRole('group')).toEqual([
    screen.getByRole('group', { name: 'Colour by' }),
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

test("the Note tab's comment field holds a comment per node or edge, kept while others are selected and the inspector closed", async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={pageWith(review)} send={async () => {}} />);
  const comment = () => within(noteTab()).getByRole('textbox', { name: 'Your comment' });

  const rust = await screen.findByRole('group', { name: 'rust' });
  await user.click(within(rust).getByRole('button', { name: 'domain: unchanged' }));
  await write(user, comment(), 'Keep domain free of IO.');
  await user.click(within(rust).getByRole('button', { name: 'application → domain: unchanged' }));
  expect(comment()).toHaveProperty('value', '');
  await write(user, comment(), 'Why this way round?');
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
  const comment = () => within(noteTab()).getByRole('textbox', { name: 'Your comment' });
  const reviewButton = () => screen.getByRole('button', { name: 'Review' });

  const rust = await screen.findByRole('group', { name: 'rust' });
  await user.click(within(rust).getByRole('button', { name: 'domain: unchanged' }));
  await write(user, comment(), 'Keep domain free of IO.');
  await user.click(within(rust).getByRole('button', { name: 'application → domain: unchanged' }));
  await write(user, comment(), 'Why this way round?');
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
    within(within(noteTab()).getByRole('radiogroup', { name: 'Comment kind' })).getByRole('radio', {
      name,
    });

  const rust = await screen.findByRole('group', { name: 'rust' });
  await user.click(within(rust).getByRole('button', { name: 'domain: unchanged' }));
  expect(kind('Question')).toHaveProperty('checked', true);
  await user.click(kind('Change this'));
  await write(
    user,
    within(noteTab()).getByRole('textbox', { name: 'Your comment' }),
    'Move the IO out of domain.',
  );
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

const verdict = (name: string) =>
  within(screen.getByRole('radiogroup', { name: 'Verdict' })).getByRole('radio', { name });

const suggestedVerdict = () =>
  within(screen.getByRole('radiogroup', { name: 'Verdict' })).getByRole('radio', {
    description: 'suggested',
  });

test('the verdict follows the drafts, Approve with none or only suggestions, Comment once a question is drafted, Request changes once a change is, until one is picked, which holds as the drafts change and while the tray is closed', async () => {
  const user = userEvent.setup();
  const sent = vi.fn(async () => {});
  render(<ReviewPage review={pageWith(review)} send={sent} />);
  const comment = () => within(noteTab()).getByRole('textbox', { name: 'Your comment' });

  const rust = await screen.findByRole('group', { name: 'rust' });
  await openReview(user);
  expect(verdict('Approve')).toHaveProperty('checked', true);
  await user.click(within(rust).getByRole('button', { name: 'cli-adapter: added' }));
  await pickKind(user, 'Suggestion');
  await write(user, comment(), 'A builder might read better.');
  expect(verdict('Approve')).toHaveProperty('checked', true);
  await user.click(within(rust).getByRole('button', { name: 'domain: unchanged' }));
  await write(user, comment(), 'Why here?');
  expect(verdict('Comment')).toHaveProperty('checked', true);
  await user.click(within(rust).getByRole('button', { name: 'application: modified' }));
  await pickKind(user, 'Change this');
  await write(user, comment(), 'Split it.');
  expect(verdict('Request changes')).toHaveProperty('checked', true);
  expect(suggestedVerdict()).toBe(verdict('Request changes'));

  await user.click(verdict('Comment'));
  await user.click(within(rust).getByRole('button', { name: 'legacy: removed' }));
  await pickKind(user, 'Change this');
  await write(user, comment(), 'Keep it a release longer.');
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
  await write(user, within(noteTab()).getByRole('textbox', { name: 'Your comment' }), 'Why here?');
  expect(suggestedVerdict()).toBe(verdict('Comment'));
  await user.click(screen.getByRole('button', { name: 'Send to Claude' }));

  expect(sent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ verdict: 'approve' }));
});

test('Send to Claude waits for a comment that is more than blanks, and sends no blank or cleared one', async () => {
  const user = userEvent.setup();
  const sent = vi.fn(async () => {});
  render(<ReviewPage review={pageWith(review)} send={sent} />);
  const comment = () => within(noteTab()).getByRole('textbox', { name: 'Your comment' });
  const sendButton = () => screen.getByRole('button', { name: 'Send to Claude' });

  const rust = await screen.findByRole('group', { name: 'rust' });
  await openReview(user);
  await user.click(verdict('Comment'));
  expect(sendButton()).toHaveProperty('disabled', true);
  await write(user, screen.getByRole('textbox', { name: 'General comment' }), '  ');
  expect(sendButton()).toHaveProperty('disabled', true);
  await user.click(within(rust).getByRole('button', { name: 'domain: unchanged' }));
  await write(user, comment(), '  ');
  expect(sendButton()).toHaveProperty('disabled', true);
  await user.click(within(rust).getByRole('button', { name: 'application → domain: unchanged' }));
  await write(user, comment(), 'Why this way round?');
  await user.click(within(rust).getByRole('button', { name: 'application: modified' }));
  await write(user, comment(), 'Split the crate.');
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

const findingInRail = (target: string) =>
  within(screen.getByRole('complementary', { name: 'Findings' }))
    .getByRole('button', { name: new RegExp(`^${target}: `) })
    .closest('li') ?? screen.getByRole('list', { name: 'no such finding' });

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
  await user.click(within(noteTab()).getByRole('button', { name: 'Fix this' }));
  expect(
    within(noteTab())
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
  const comment = () => within(noteTab()).queryByRole('textbox', { name: 'Your comment' });
  const answers = () => within(findingInRail('domain')).queryByRole('group', { name: 'Answer' });
  const noteAnswers = () => within(noteTab()).queryByRole('group', { name: 'Answer' });
  const reviewButton = () => screen.queryByRole('button', { name: 'Review' });

  const rust = await screen.findByRole('group', { name: 'rust' });
  await user.click(within(rust).getByRole('button', { name: 'domain: unchanged' }));
  await user.click(screen.getByRole('button', { name: 'Show 1 finding' }));
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
  await write(
    user,
    within(noteTab()).getByRole('textbox', { name: 'Your comment' }),
    'Keep domain free of IO.',
  );
  await openReview(user);
  await user.click(screen.getByRole('button', { name: 'Send to Claude' }));

  expect((await screen.findByRole('status', { name: 'Review' })).textContent).toBe(
    'The review was not sent: 403 Forbidden',
  );
  expect(screen.getByRole('button', { name: 'Send to Claude' })).not.toBeNull();
});

const tray = () => screen.getByRole('region', { name: 'Review tray' });

const pickKind = (user: ReturnType<typeof userEvent.setup>, name: string) =>
  user.click(
    within(within(noteTab()).getByRole('radiogroup', { name: 'Comment kind' })).getByRole('radio', {
      name,
    }),
  );

test("the review tray sits at the page's foot, its line counting the drafts and each kind among them, blank ones left out", async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={pageWith(review)} send={async () => {}} />);
  const comment = () => within(noteTab()).getByRole('textbox', { name: 'Your comment' });

  const rust = await screen.findByRole('group', { name: 'rust' });
  expect(within(tray()).getByText('Nothing drafted')).toBeDefined();
  await user.click(within(rust).getByRole('button', { name: 'domain: unchanged' }));
  await write(user, comment(), 'Why here?');
  expect(within(tray()).getByText('1 drafted · 1 question')).toBeDefined();
  await user.click(within(rust).getByRole('button', { name: 'application: modified' }));
  await pickKind(user, 'Change this');
  await write(user, comment(), 'Split it.');
  await user.click(within(rust).getByRole('button', { name: 'application → domain: unchanged' }));
  await write(user, comment(), 'And this?');
  await user.click(within(rust).getByRole('button', { name: 'cli-adapter: added' }));
  await write(user, comment(), '  ');
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
  const comment = () => within(noteTab()).getByRole('textbox', { name: 'Your comment' });
  const draft = async (name: string, text: string) => {
    await user.click(
      within(screen.getByRole('group', { name: 'rust' })).getByRole('button', { name }),
    );
    await write(user, comment(), text);
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

  await user.click(screen.getByRole('link', { name: 'Metrics' }));
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
  await write(user, within(noteTab()).getByRole('textbox', { name: 'Your comment' }), 'Why here?');
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

  await user.click(screen.getByRole('link', { name: 'Metrics' }));
  await user.click(within(drafts).getByRole('button', { name: 'cyclomatic 30, over 20' }));
  await waitFor(() => expect(currentTab()).toBe('Structure'));
  expect(within(inspector()).getByRole('heading', { name: 'application' })).not.toBeNull();
});

type FrameOptions = {
  readonly width: number;
  readonly windowHeight: number;
  readonly notes?: ReviewNotes;
};

const renderInFrame = (page: PageData, { width, windowHeight, notes }: FrameOptions) => {
  const frame = frameOfWidth(width);
  vi.stubGlobal('ResizeObserver', frame.Observer);
  const innerHeight = vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(windowHeight);
  onTestFinished(() => {
    vi.stubGlobal('ResizeObserver', frameOfWidth(WIDE_FRAME).Observer);
    innerHeight.mockRestore();
  });
  return { ...render(<ReviewPage review={page} notes={notes} />), resize: frame.resize };
};

const zoomShown = () => screen.getByRole('status', { name: 'Zoom' }).textContent;

const viewOf = (stack: HTMLElement) => stack.parentElement?.getAttribute('transform');

test.for([
  { frameIs: 'half the graph wide', widthTimes: 0.5, window: 'tall', xTimes: 0 },
  { frameIs: 'twice the graph wide', widthTimes: 2, window: 'half the graph high', xTimes: 0.75 },
])(
  'in a frame $frameIs and a window $window, the graph opens fitted at 50%, centred in a frame as high as the graph fitted to its width within the window',
  async ({ widthTimes, window, xTimes }) => {
    const graph = await layoutDiff(review.diff);
    renderInFrame(pageWith(review), {
      width: graph.width * widthTimes,
      windowHeight: window === 'tall' ? 10_000 : graph.height / 2 + 48,
    });

    const frame = await screen.findByRole('group', { name: 'Graph' });
    const rust = await within(frame).findByRole('group', { name: 'rust' });
    expect(zoomShown()).toBe('50%');
    expect(viewOf(rust)).toBe(`translate(${graph.width * xTimes} 0) scale(0.5)`);
    expect(frame.style.height).toBe(`${graph.height / 2}px`);
  },
);

test('the toolbar zooms the graph by steps of 1.25, to 100% about the frame centre and back to fitted, and a relayout refits', async () => {
  const user = userEvent.setup();
  const graph = await layoutDiff(review.diff);
  renderInFrame(pageWith(review), { width: graph.width / 2, windowHeight: 10_000 });
  const rust = await screen.findByRole('group', { name: 'rust' });
  const press = (name: string) => user.click(screen.getByRole('button', { name }));

  await press('Zoom in');
  expect(zoomShown()).toBe('63%');
  await press('Zoom out');
  expect(zoomShown()).toBe('50%');
  await press('100%');
  expect(zoomShown()).toBe('100%');
  expect(viewOf(rust)).toBe(`translate(${-graph.width / 4} ${-graph.height / 4}) scale(1)`);
  await press('Fit');
  expect(zoomShown()).toBe('50%');
  expect(viewOf(rust)).toBe('translate(0 0) scale(0.5)');

  await press('Zoom in');
  await showEverything(user);
  await waitFor(() => expect(zoomShown()).toBe('50%'));
});

test('dragging from a node pans the graph and selects nothing, even back near where it began, while a press that barely moves still selects it', async () => {
  const user = userEvent.setup();
  const graph = await layoutDiff(review.diff);
  renderInFrame(pageWith(review), { width: graph.width / 2, windowHeight: 10_000 });
  const rust = await screen.findByRole('group', { name: 'rust' });
  await user.click(screen.getByRole('button', { name: '100%' }));
  const domain = within(rust).getByRole('button', { name: 'domain: unchanged' });
  const drag = (...moves: ReadonlyArray<{ readonly clientX: number; readonly clientY: number }>) =>
    user.pointer([
      { keys: '[MouseLeft>]', target: domain, coords: { clientX: 100, clientY: 100 } },
      ...moves.map(coords => ({ coords })),
      { keys: '[/MouseLeft]' },
    ]);
  const pannedBy = (x: number, y: number) =>
    `translate(${x - graph.width / 4} ${y - graph.height / 4}) scale(1)`;

  await drag({ clientX: 140, clientY: 130 });
  expect(viewOf(rust)).toBe(pannedBy(40, 30));
  await drag({ clientX: 140, clientY: 130 }, { clientX: 102, clientY: 101 });
  expect(viewOf(rust)).toBe(pannedBy(42, 31));
  expect(screen.queryByRole('complementary', { name: 'Inspector' })).toBeNull();

  await drag({ clientX: 103, clientY: 100 });
  expect(viewOf(rust)).toBe(pannedBy(42, 31));
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
  renderInFrame(pageWith(review), { width: graph.width / 2, windowHeight: 10_000 });
  const rust = await screen.findByRole('group', { name: 'rust' });
  const frame = screen.getByRole('group', { name: 'Graph' });
  const at100 = (x: number, y: number) =>
    `translate(${x - graph.width / 4} ${y - graph.height / 4}) scale(1)`;
  frame.focus();

  await user.keyboard('+');
  expect(zoomShown()).toBe('63%');
  await user.keyboard('=');
  expect(zoomShown()).toBe('78%');
  await user.keyboard('-');
  expect(zoomShown()).toBe('63%');
  await user.keyboard('1');
  expect(viewOf(rust)).toBe(at100(0, 0));
  await user.keyboard('{ArrowRight}');
  expect(viewOf(rust)).toBe(at100(-40, 0));
  await user.keyboard('{ArrowDown}');
  expect(viewOf(rust)).toBe(at100(-40, -40));
  await user.keyboard('{ArrowLeft}{ArrowLeft}');
  expect(viewOf(rust)).toBe(at100(40, -40));
  await user.keyboard('{ArrowUp}{ArrowUp}');
  expect(viewOf(rust)).toBe(at100(40, 40));
  expect(fireEvent.keyDown(frame, { key: 'ArrowUp' })).toBe(false);
  expect(fireEvent.keyDown(frame, { key: 'Tab' })).toBe(true);
  expect(fireEvent.keyDown(frame, { key: '=', ctrlKey: true })).toBe(true);
  expect(fireEvent.keyDown(frame, { key: '-', metaKey: true })).toBe(true);
  expect(fireEvent.keyDown(frame, { key: 'ArrowLeft', altKey: true })).toBe(true);
  expect(viewOf(rust)).toBe(at100(40, 80));
  await user.keyboard('0');
  expect(viewOf(rust)).toBe('translate(0 0) scale(0.5)');
});

test("resizing the frame keeps the zoom and the graph point at the frame's centre", async () => {
  const user = userEvent.setup();
  const graph = await layoutDiff(review.diff);
  const { resize } = renderInFrame(pageWith(review), {
    width: graph.width / 2,
    windowHeight: 10_000,
  });
  const rust = await screen.findByRole('group', { name: 'rust' });
  await user.click(screen.getByRole('button', { name: '100%' }));

  resize((graph.width * 3) / 4);
  expect(zoomShown()).toBe('100%');
  expect(viewOf(rust)).toBe(`translate(${-graph.width / 8} ${-graph.height / 8}) scale(1)`);
});

const onScreen = (
  element: Element | null,
  point = { x: 0, y: 0 },
): { readonly x: number; readonly y: number } => {
  const transform = element?.getAttribute('transform');
  if (!element || !transform) return point;
  const [, x = '0', y = '0'] = /translate\(([^ ]+) ([^)]+)\)/.exec(transform) ?? [];
  const [, scale = '1'] = /scale\(([^)]+)\)/.exec(transform) ?? [];
  return onScreen(element.parentElement, {
    x: Number(x) + point.x * Number(scale),
    y: Number(y) + point.y * Number(scale),
  });
};

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
  await press('100%');
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
    await press('100%');
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
  await user.click(screen.getByRole('checkbox', { name: 'All edges' }));
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
        version: 1,
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

test('the Review nav links Structure, Metrics and Tests, and marks Structure the current page', async () => {
  render(<ReviewPage review={pageWith(review)} />);

  const links = within(screen.getByRole('navigation', { name: 'Review' })).getAllByRole('link');
  expect(links.map(link => link.textContent)).toEqual(['Structure', 'Metrics', 'Tests']);
  expect(links[0]?.getAttribute('href')).toBe('#structure');
  expect(links[0]?.getAttribute('aria-current')).toBe('page');
  await screen.findByRole('group', { name: 'rust' });
});

const atHash = (hash: string) => history.replaceState(null, '', hash);

const currentTab = () =>
  within(screen.getByRole('navigation', { name: 'Review' })).getByRole('link', { current: 'page' })
    .textContent;

test.for([
  { hash: '#metrics', tab: 'Metrics' },
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
  ).toEqual(['Structure', 'Metrics', 'Tests 2']);
  await user.click(screen.getByRole('link', { name: 'Tests 2' }));
  await waitFor(() => expect(currentTab()).toBe('Tests 2'));
  expect(screen.queryByRole('group', { name: 'rust' })).toBeNull();
  rerender(<ReviewPage review={pageWith(review)} />);
  expect(screen.getByRole('link', { name: 'Tests' })).not.toBeNull();
});

const testsShown = () =>
  within(screen.getByRole('region', { name: 'Test changes' }))
    .queryAllByRole('region')
    .map(file => file.getAttribute('aria-label'));

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
      notes={{ version: 1, summary: [], tests: 'The export is pinned.', notes: {} }}
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

test("a Metrics row's node name goes to it on Structure, focused, its inspector open", async () => {
  atHash('#metrics');
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        metrics: { 'rust/crate/application': { base: measured(), head: measured() } },
      })}
    />,
  );

  await user.click(
    within(screen.getByRole('region', { name: 'Metrics per node' })).getByRole('button', {
      name: 'application',
    }),
  );
  await waitFor(() => expect(currentTab()).toBe('Structure'));
  const application = await screen.findByRole('button', { name: 'application: modified' });
  await waitFor(() => expect(document.activeElement).toBe(application));
  expect(within(inspector()).getByRole('heading', { name: 'application' })).not.toBeNull();
});

test('picking a tab sets the hash and shows it, and back and forward move between the tabs', async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={pageWith(review)} />);
  await screen.findByRole('group', { name: 'rust' });

  await user.click(screen.getByRole('link', { name: 'Metrics' }));
  await waitFor(() => expect(currentTab()).toBe('Metrics'));
  expect(location.hash).toBe('#metrics');
  expect(screen.queryByRole('group', { name: 'rust' })).toBeNull();

  history.back();
  await waitFor(() => expect(currentTab()).toBe('Structure'));
  history.forward();
  await waitFor(() => expect(currentTab()).toBe('Metrics'));
  location.hash = '#tests';
  await waitFor(() => expect(currentTab()).toBe('Tests'));
});

test('a reader skipped for want of its tool is named once, at the top of the findings rail, collapsed or open, with the stacks it did not read', async () => {
  const user = userEvent.setup();
  const skipped: ReadonlyArray<Skipped> = [
    { reader: 'rust', tool: 'cargo', stacks: ['rust', 'rust~2'] },
  ];
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        skipped,
        findings: raisedFindings({
          skipped,
          changedPaths: [],
          undrawn: [],
          dangling: [],
          dependencyChanges: [],
          migrations: [],
          schemas: [],
          metricFindings: [],
          symbols: [],
          symbolsNotRead: [],
          tests: [],
          nodes: [],
          split: undefined,
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
        version: 1,
        tests: '',
        summary: [],
        notes: {
          'rust/crate/application': { text: 'Adds the export use case.' },
          'rust/crate/cli-adapter': { text: 'A second way in.', flag: 'new entry point' },
          'rust/crate/cli-adapter -> rust/crate/application': {
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

test("a drawn node's or edge's badge names its findings under the worst level, says so on hover, and clicking it opens its note, which lists them", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        findings: [
          findingOn('rust/crate/domain'),
          findingOn('rust/crate/cli-adapter', { title: 'cyclomatic 4 → 14, over 10' }),
        ],
      })}
      notes={{
        version: 1,
        tests: '',
        summary: [],
        notes: {
          'rust/crate/cli-adapter': { text: 'A second way in.', flag: 'new entry point' },
          'rust/crate/cli-adapter -> rust/crate/application': {
            text: 'The CLI drives the use case.',
            flag: 'new dependency direction',
          },
        },
      }}
    />,
  );

  await showEverything(user);
  await screen.findByRole('button', { name: 'domain: unchanged' });
  const entry = screen.getByRole('img', {
    name: 'needs a look, 2 findings: cyclomatic 4 → 14, over 10; new entry point',
  });
  expect(entry.querySelector('title')?.textContent).toBe(
    'needs a look, 2 findings: cyclomatic 4 → 14, over 10; new entry point',
  );
  expect(
    screen.getByRole('img', { name: 'for information, 1 finding: lines 900, over 800' }),
  ).toBeTruthy();
  expect(screen.getAllByRole('img', { name: /finding/ })).toHaveLength(3);

  await user.click(
    screen.getByRole('img', { name: 'needs a look, 1 finding: new dependency direction' }),
  );
  expect(noteShown()).toBe('The CLI drives the use case.');
  await user.click(entry);
  expect(noteShown()).toBe('A second way in.');
  expect(findingsShown()).toEqual(['cyclomatic 4 → 14, over 10', 'new entry point']);

  await user.click(screen.getByRole('button', { name: 'domain: unchanged' }));
  expect(findingsShown()).toEqual(['lines 900, over 800']);
  await user.click(screen.getByRole('button', { name: 'application: modified' }));
  expect(within(noteTab()).queryByRole('list', { name: 'Findings' })).toBeNull();

  const structure = () =>
    within(screen.getByRole('group', { name: 'Triage' })).getByRole('button', {
      name: /Structure/,
    });
  await user.click(structure());
  expect(screen.getAllByRole('img', { name: /finding/ }).map(badge => badge.ariaLabel)).toEqual([
    'needs a look, 1 finding: new dependency direction',
    'for information, 1 finding: lines 900, over 800, outside Structure',
    'needs a look, 2 findings: cyclomatic 4 → 14, over 10; new entry point',
  ]);
  await user.click(structure());
  expect(
    screen.getByRole('img', { name: 'for information, 1 finding: lines 900, over 800' }),
  ).toBeTruthy();
});

test('the summary lists its items, not the flagged notes, and an item with a target takes focus to it and shows its note; with no items there is no summary', async () => {
  const user = userEvent.setup();
  const { rerender } = render(
    <ReviewPage
      review={pageWith({
        ...review,
      })}
      notes={{
        version: 1,
        tests: '',
        summary: [
          { text: 'The CLI is a new adapter.', target: 'rust/crate/cli-adapter' },
          { text: 'Domain is untouched.' },
        ],
        notes: {
          'rust/crate/cli-adapter': { text: 'A second way in.' },
          'rust/crate/cli-adapter -> rust/crate/application': {
            text: 'The CLI drives the use case.',
            flag: 'new dependency direction',
          },
          'rust/crate/legacy': {
            text: 'Domain still reaches it.',
            flag: 'removed but depended on',
          },
        },
      }}
    />,
  );

  const summary = await screen.findByRole('region', { name: 'Summary' });
  const items = within(summary).getAllByRole('listitem');
  expect(items.map(item => item.textContent)).toEqual([
    'The CLI is a new adapter.',
    'Domain is untouched.',
  ]);
  expect(
    within(summary)
      .getAllByRole('button')
      .map(button => button.textContent),
  ).toEqual(['The CLI is a new adapter.']);

  const focus = vi.spyOn(SVGElement.prototype, 'focus');
  onTestFinished(() => focus.mockRestore());
  await user.click(within(summary).getByRole('button', { name: 'The CLI is a new adapter.' }));
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'cli-adapter: added' })),
  );
  expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  expect(noteShown()).toBe('A second way in.');

  rerender(
    <ReviewPage
      review={pageWith(review)}
      notes={{ version: 1, tests: '', summary: [], notes: {} }}
    />,
  );
  expect(screen.queryByRole('region', { name: 'Summary' })).toBeNull();
});

test("the findings rail starts collapsed to their total and how many need a look or are for information, notes' flags among them; opened, it groups them by dimension, each line its title, with its detail if any, and its target, else its detail, and hides again; the triage strip has a chip per dimension with findings, marked when one needs a look, that filters the rail until clicked again, and none without findings", async () => {
  const user = userEvent.setup();
  const { rerender } = render(
    <ReviewPage
      review={pageWith({
        ...review,
        findings: [
          findingOn('rust/crate/domain'),
          findingOn('rust/crate/application', {
            id: 'metrics:cyclomatic:rust/crate/application',
            level: 'look',
          }),
          findingOn('rust/crate/cli-adapter', {
            id: 'routes:dangling:rust/crate/cli-adapter',
            dimension: 'routes',
            title: '2 calls with no route',
            detail: '/api/info, /api/users',
          }),
          {
            id: 'structure:undrawn',
            check: 'structure:undrawn',
            dimension: 'structure',
            level: 'info',
            title: '1 changed file outside the graph',
            detail: 'README.md',
          },
        ],
        undrawn: [{ path: 'README.md', patch: '' }],
      })}
      notes={{
        version: 1,
        tests: '',
        summary: [],
        notes: {
          'rust/crate/cli-adapter': { text: 'A second way in.', flag: 'new entry point' },
          'rust/crate/domain': { text: 'Untouched.' },
          'rust/crate/cli-adapter -> rust/crate/application': {
            text: 'The CLI drives the use case.',
            flag: 'new dependency direction',
          },
        },
      }}
    />,
  );

  await screen.findByRole('navigation', { name: 'Findings' });
  const rail = () => screen.getByRole('navigation', { name: 'Findings' });
  expect(within(rail()).getByRole('button', { name: 'Show 6 findings' })).toBeDefined();
  const countBy = (level: string) =>
    within(rail()).getByRole('img', { name: level }).parentElement?.textContent;
  expect(countBy('needs a look')).toBe('3');
  expect(countBy('for information')).toBe('3');

  const groupsShown = async () => {
    await user.click(screen.getByRole('button', { name: /^Show \d+ findings?$/ }));
    const open = screen.getByRole('complementary', { name: 'Findings' });
    const groups = within(open)
      .getAllByRole('heading', { level: 3 })
      .map(heading => heading.textContent);
    await user.click(within(open).getByRole('button', { name: 'Hide findings' }));
    return groups;
  };
  expect(await groupsShown()).toEqual(['Structure', 'Metrics', 'Routes']);
  expect(screen.queryByRole('complementary', { name: 'Findings' })).toBeNull();

  await user.click(screen.getByRole('button', { name: 'Show 6 findings' }));
  const lines = (group: string) =>
    within(screen.getByRole('region', { name: group }))
      .getAllByRole('button')
      .map(button => button.getAttribute('aria-label'));
  expect(lines('Structure')).toEqual([
    'README.md: 1 changed file outside the graph',
    'cli-adapter: new entry point',
    'cli-adapter → application: new dependency direction',
  ]);
  expect(lines('Routes')).toEqual(['cli-adapter: 2 calls with no route: /api/info, /api/users']);

  const strip = () => within(screen.getByRole('group', { name: 'Triage' }));
  const chips = () =>
    strip()
      .getAllByRole('button')
      .map(
        chip =>
          `${chip.textContent}${within(chip).queryByRole('img', { name: 'needs a look' }) ? ' ▲' : ''} ${chip.getAttribute('aria-pressed')}`,
      );
  expect(chips()).toEqual(['Structure 3 ▲ false', 'Metrics 2 ▲ false', 'Routes 1 false']);
  const headings = () =>
    within(screen.getByRole('complementary', { name: 'Findings' }))
      .getAllByRole('heading', { level: 3 })
      .map(heading => heading.textContent);
  const metricsChip = () => strip().getByRole('button', { name: /Metrics/ });
  await user.click(metricsChip());
  expect(chips()).toEqual(['Structure 3 ▲ false', 'Metrics 2 ▲ true', 'Routes 1 false']);
  expect(headings()).toEqual(['Metrics']);
  await user.click(metricsChip());
  expect(chips()).toEqual(['Structure 3 ▲ false', 'Metrics 2 ▲ false', 'Routes 1 false']);
  expect(headings()).toEqual(['Structure', 'Metrics', 'Routes']);
  await user.click(screen.getByRole('button', { name: 'Hide findings' }));

  rerender(
    <ReviewPage
      review={pageWith({
        ...review,
        findings: [findingOn('rust/crate/domain')],
      })}
    />,
  );
  expect(within(rail()).getByRole('button', { name: 'Show 1 finding' })).toBeDefined();
  expect(countBy('needs a look')).toBe('0');
  expect(await groupsShown()).toEqual(['Metrics']);
  expect(chips()).toEqual(['Metrics 1 false']);

  rerender(<ReviewPage review={pageWith({ ...review, findings: [] })} />);
  expect(within(rail()).getByRole('button', { name: 'Show 0 findings' })).toBeDefined();
  expect(screen.queryByRole('group', { name: 'Triage' })).toBeNull();
});

test("a note's or a metric finding in the rail goes to its node or edge as the summary's links do", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        findings: [findingOn('rust/crate/domain')],
      })}
      notes={{
        version: 1,
        tests: '',
        summary: [],
        notes: {
          'rust/crate/cli-adapter -> rust/crate/application': {
            text: 'The CLI drives the use case.',
            flag: 'new dependency direction',
          },
        },
      }}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'Show 2 findings' }));
  const rail = () => within(screen.getByRole('complementary', { name: 'Findings' }));
  await user.click(rail().getByRole('button', { name: /^cli-adapter → application: new/ }));
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole('button', {
        name: 'cli-adapter → application: added, flagged: new dependency direction',
      }),
    ),
  );
  expect(noteShown()).toBe('The CLI drives the use case.');

  await user.click(rail().getByRole('button', { name: 'domain: lines 900, over 800' }));
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'domain: unchanged' }));
});

test("the reading order numbers the changed parts in its order, on the graph too, each marked with its findings' worst level and count, a cycle's first part saying it is one, and going to its part as the summary's links do", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        readingOrder: {
          parts: ['rust/crate/application', 'rust/crate/cli-adapter', 'rust/crate/legacy'],
          cycles: [['rust/crate/application', 'rust/crate/cli-adapter', 'rust/crate/legacy']],
        },
        findings: [
          findingOn('rust/crate/cli-adapter'),
          findingOn('rust/crate/cli-adapter', { id: 'notes:cli-adapter', level: 'look' }),
          findingOn('rust/crate/legacy'),
          findingOn('rust/crate/domain'),
        ],
        undrawn: [
          { path: 'README.md', patch: '' },
          { path: 'docs/a.md', patch: '' },
        ],
      })}
    />,
  );
  await screen.findByRole('group', { name: 'rust' });

  const numberOn = (node: string) =>
    within(screen.getByRole('button', { name: node }))
      .queryAllByRole('img', { name: /^Reading order/ })
      .map(number => number.getAttribute('aria-label'));
  expect(numberOn('application: modified')).toEqual(['Reading order 1']);
  expect(numberOn('legacy: removed')).toEqual(['Reading order 3']);
  expect(numberOn('domain: unchanged')).toEqual([]);

  const order = screen.getByRole('navigation', { name: 'Reading order' });
  expect(
    within(order)
      .getAllByRole('button')
      .map(item => item.textContent),
  ).toEqual(['1 application', '2 cli-adapter', '3 legacy', '4 README.md', '5 docs/a.md']);
  expect(within(order).getByRole('heading', { name: 'Outside the graph' })).toBeDefined();
  await user.click(within(order).getByRole('button', { name: '5 docs/a.md' }));
  expect(within(inspector()).getByRole('heading', { level: 2 }).textContent).toBe(
    'Changed files outside the graph',
  );
  const [first, second, third] = within(order).getAllByRole('listitem');
  expect(
    within(second ?? order).getByRole('img', { name: 'needs a look, 2 findings' }),
  ).toBeDefined();
  expect(
    within(third ?? order).getByRole('img', { name: 'for information, 1 finding' }),
  ).toBeDefined();
  expect(within(first ?? order).queryByRole('img')).toBeNull();
  expect(within(order).getAllByText(/depend on each other/)).toEqual([
    within(first ?? order).getByText('3 parts depend on each other: read in name order'),
  ]);
  await user.click(within(order).getByRole('button', { name: '2 cli-adapter' }));
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'cli-adapter: added' }));
  expect(within(inspector()).getByRole('heading', { level: 2 }).textContent).toBe('cli-adapter');
});

test('the reading order shows no outside heading when every changed file is drawn, lists the outside files alone when no part changed, and is gone when nothing changed', async () => {
  const { rerender } = render(
    <ReviewPage
      review={pageWith({
        ...review,
        readingOrder: { parts: ['rust/crate/application'], cycles: [] },
      })}
    />,
  );
  await screen.findByRole('group', { name: 'rust' });

  const order = screen.getByRole('navigation', { name: 'Reading order' });
  expect(
    within(order)
      .getAllByRole('button')
      .map(row => row.textContent),
  ).toEqual(['1 application']);
  expect(within(order).queryByRole('heading', { name: 'Outside the graph' })).toBeNull();

  rerender(
    <ReviewPage review={pageWith({ ...review, undrawn: [{ path: 'README.md', patch: '' }] })} />,
  );
  expect(
    within(screen.getByRole('navigation', { name: 'Reading order' }))
      .getAllByRole('button')
      .map(row => row.textContent),
  ).toEqual(['1 README.md']);

  rerender(<ReviewPage review={pageWith(review)} />);
  expect(screen.queryByRole('navigation', { name: 'Reading order' })).toBeNull();
});

test('the reading order counts the parts read only when it has parts, a single part in the singular', async () => {
  const { rerender } = render(
    <ReviewPage review={pageWith({ ...review, undrawn: [{ path: 'README.md', patch: '' }] })} />,
  );
  await screen.findByRole('group', { name: 'rust' });
  expect(within(readingOrder()).queryByText(/read$/)).toBeNull();

  rerender(
    <ReviewPage
      review={pageWith({
        ...review,
        readingOrder: { parts: ['rust/crate/application'], cycles: [] },
      })}
    />,
  );
  expect(within(readingOrder()).getByText('0 of 1 part read')).toBeDefined();
});

const walkedReview = () =>
  pageWith({
    ...review,
    range: `walk-${crypto.randomUUID()}`,
    readingOrder: {
      parts: ['rust/crate/application', 'rust/crate/cli-adapter', 'rust/crate/legacy'],
      cycles: [],
    },
  });

const selectedPart = () => within(inspector()).getByRole('heading', { level: 2 }).textContent;

test('J and K walk the reading order from the selected part, starting at its first part, going to each as its row does, and stay put at either end', async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={walkedReview()} />);
  await screen.findByRole('group', { name: 'rust' });

  await user.keyboard('k');
  expect(selectedPart()).toBe('application');
  await user.keyboard('j');
  expect(selectedPart()).toBe('cli-adapter');
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'cli-adapter: added' })),
  );
  await user.keyboard('jjj');
  expect(selectedPart()).toBe('legacy');
  await user.keyboard('kkk');
  expect(selectedPart()).toBe('application');
});

const readingOrder = () => screen.getByRole('navigation', { name: 'Reading order' });

const readRows = () =>
  within(readingOrder())
    .getAllByRole('listitem')
    .filter(row => within(row).queryByRole('img', { name: 'read' }) !== null)
    .map(row => within(row).getByRole('button').textContent);

test('A marks the selected part read, ticking its row and counting it at the head of the reading order, and A again leaves it unread', async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={walkedReview()} />);
  await screen.findByRole('group', { name: 'rust' });
  expect(within(readingOrder()).getByText('0 of 3 parts read')).toBeDefined();

  await user.keyboard('ja');
  await user.keyboard('jja');
  expect(readRows()).toEqual(['1 application', '3 legacy']);
  expect(within(readingOrder()).getByText('2 of 3 parts read')).toBeDefined();

  await user.keyboard('a');
  expect(readRows()).toEqual(['1 application']);
  expect(within(readingOrder()).getByText('1 of 3 parts read')).toBeDefined();

  await user.click(screen.getByRole('button', { name: 'domain: unchanged' }));
  await user.keyboard('a');
  expect(within(readingOrder()).getByText('1 of 3 parts read')).toBeDefined();
});

test('a part marked read stays read when the page for its range opens again, and the page for another range starts with none read', async () => {
  const user = userEvent.setup();
  const walked = walkedReview();
  const first = render(<ReviewPage review={walked} />);
  await screen.findByRole('group', { name: 'rust' });
  await user.keyboard('ja');
  first.unmount();

  const again = render(<ReviewPage review={walked} />);
  await screen.findByRole('group', { name: 'rust' });
  expect(readRows()).toEqual(['1 application']);
  expect(within(readingOrder()).getByText('1 of 3 parts read')).toBeDefined();
  again.unmount();

  render(<ReviewPage review={walkedReview()} />);
  await screen.findByRole('group', { name: 'rust' });
  expect(readRows()).toEqual([]);
});

test('with storage refusing every access, the page opens and marks hold until it closes', async () => {
  const user = userEvent.setup();
  const refused = () => {
    throw new DOMException('denied', 'SecurityError');
  };
  const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(refused);
  const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(refused);
  onTestFinished(() => {
    getItem.mockRestore();
    setItem.mockRestore();
  });
  const first = render(<ReviewPage review={walkedReview()} />);
  await screen.findByRole('group', { name: 'rust' });
  await user.keyboard('ja');
  expect(readRows()).toEqual(['1 application']);
  first.unmount();

  const storage = vi.spyOn(window, 'localStorage', 'get').mockImplementation(refused);
  onTestFinished(() => storage.mockRestore());
  render(<ReviewPage review={walkedReview()} />);
  await screen.findByRole('group', { name: 'rust' });

  await user.keyboard('ja');
  expect(readRows()).toEqual(['1 application']);
});

test('a stored mark on a part no longer in the reading order, the range having moved on, is not counted', async () => {
  const walked = walkedReview();
  localStorage.setItem(
    `visual-review:read:${walked.range}`,
    '["rust/crate/legacy", "rust/crate/gone"]',
  );
  render(<ReviewPage review={walked} />);
  await screen.findByRole('group', { name: 'rust' });

  expect(within(readingOrder()).getByText('1 of 3 parts read')).toBeDefined();
});

test('the review sends the parts marked read in reading order, none outside it, beside the comments and what the page was drawn for', async () => {
  const user = userEvent.setup();
  const sent = vi.fn(async () => {});
  const walked = {
    ...walkedReview(),
    pullRequest: {
      number: 16,
      title: 'Split the CLI',
      url: 'https://github.com/acme/shop/pull/16',
    },
  };
  localStorage.setItem(`visual-review:read:${walked.range}`, '["rust/crate/gone"]');
  render(<ReviewPage review={walked} send={sent} />);
  await screen.findByRole('group', { name: 'rust' });

  await user.keyboard('jjja');
  await user.keyboard('kka');
  await user.keyboard('j');
  await write(
    user,
    within(noteTab()).getByRole('textbox', { name: 'Your comment' }),
    'Is this adapter tested?',
  );
  await openReview(user);
  await user.click(screen.getByRole('button', { name: 'Send to Claude' }));

  expect(sent).toHaveBeenCalledExactlyOnceWith(
    sentReview({
      reviewed: { range: walked.range, pullRequest: 16 },
      read: ['rust/crate/application', 'rust/crate/legacy'],
      comments: [
        {
          anchor: { kind: 'part', id: 'rust/crate/cli-adapter' },
          kind: 'question',
          text: 'Is this adapter tested?',
        },
      ],
    }),
  );
});

test('the review says how many parts of the reading order were read before it is sent, and says nothing of it when the order has none', async () => {
  const user = userEvent.setup();
  const sent = vi.fn(async () => {});
  const walked = render(<ReviewPage review={walkedReview()} send={sent} />);
  await screen.findByRole('group', { name: 'rust' });
  await user.keyboard('ja');
  await openReview(user);

  const panel = () => screen.getByRole('group', { name: 'Review' });
  expect(within(panel()).getByText('1 of 3 parts read')).toBeDefined();
  walked.unmount();

  render(<ReviewPage review={pageWith(review)} send={sent} />);
  await screen.findByRole('group', { name: 'rust' });
  await openReview(user);
  expect(within(panel()).queryByText(/read$/)).toBeNull();
});

test('parts read with nothing drafted suggest Approve, sent with the parts read', async () => {
  const user = userEvent.setup();
  const sent = vi.fn(async () => {});
  render(<ReviewPage review={walkedReview()} send={sent} />);
  await screen.findByRole('group', { name: 'rust' });
  await user.keyboard('jaja');
  await openReview(user);

  expect(suggestedVerdict()).toBe(verdict('Approve'));
  await user.click(screen.getByRole('button', { name: 'Send to Claude' }));
  expect(sent).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      verdict: 'approve',
      read: ['rust/crate/application', 'rust/crate/cli-adapter'],
    }),
  );
});

test('the open tray names the parts read with nothing to say, in reading order, a blank draft saying nothing', async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={walkedReview()} send={async () => {}} />);
  const rust = await screen.findByRole('group', { name: 'rust' });
  await user.keyboard('jajaja');
  await user.click(within(rust).getByRole('button', { name: 'cli-adapter: added' }));
  await write(user, within(noteTab()).getByRole('textbox', { name: 'Your comment' }), 'Why?');
  await user.click(within(rust).getByRole('button', { name: 'legacy: removed' }));
  await write(user, within(noteTab()).getByRole('textbox', { name: 'Your comment' }), ' ');
  await openReview(user);

  const silent = within(tray()).getByRole('list', { name: 'Read, nothing to say' });
  expect(
    within(silent)
      .getAllByRole('listitem')
      .map(item => item.textContent),
  ).toEqual(['application', 'legacy']);
});

test("the open tray previews what Claude gets as lines: the verdict and parts read, each draft's kind and what it is on in the tray's order, and the parts read with nothing to say", async () => {
  const user = userEvent.setup();
  const walked = render(<ReviewPage review={walkedReview()} send={async () => {}} />);
  const rust = await screen.findByRole('group', { name: 'rust' });
  await user.keyboard('ja');
  await user.click(within(rust).getByRole('button', { name: 'application → domain: unchanged' }));
  await write(user, within(noteTab()).getByRole('textbox', { name: 'Your comment' }), 'Why?');
  await user.click(within(rust).getByRole('button', { name: 'legacy: removed' }));
  await pickKind(user, 'Change this');
  await write(user, within(noteTab()).getByRole('textbox', { name: 'Your comment' }), 'Keep it.');
  await openReview(user);

  const preview = () => within(tray()).getByLabelText('What Claude gets').textContent?.split('\n');
  expect(preview()).toEqual([
    'request-changes · read 1 of 3',
    'change    legacy',
    'question  application → domain',
    'read      1 part, no comment',
  ]);
  await user.click(verdict('Comment'));
  expect(preview()?.[0]).toBe('comment · read 1 of 3');
  walked.unmount();

  render(
    <ReviewPage
      review={pageWith({ ...review, findings: [findingOn('rust/crate/domain')] })}
      send={async () => {}}
    />,
  );
  await screen.findByRole('group', { name: 'rust' });
  await user.click(screen.getByRole('button', { name: 'Show 1 finding' }));
  await user.click(within(findingInRail('domain')).getByRole('button', { name: 'Fix this' }));
  await openReview(user);
  expect(preview()).toEqual(['request-changes', 'fix       metrics:lines:rust/crate/domain']);
});

test('A on a node outside the reading order keeps no mark, so it starts unread when the range, moved on, makes it a part', async () => {
  const user = userEvent.setup();
  const walked = walkedReview();
  const first = render(<ReviewPage review={walked} />);
  await user.click(await screen.findByRole('button', { name: 'domain: unchanged' }));
  await user.keyboard('a');
  first.unmount();

  render(
    <ReviewPage
      review={{
        ...walked,
        readingOrder: { parts: [...walked.readingOrder.parts, 'rust/crate/domain'], cycles: [] },
      }}
    />,
  );
  await screen.findByRole('group', { name: 'rust' });
  expect(within(readingOrder()).getByText('0 of 4 parts read')).toBeDefined();
});

test('stored read marks that are not a list of ids are ignored, the page starting with none read', async () => {
  const walked = walkedReview();
  localStorage.setItem(`visual-review:read:${walked.range}`, '["rust/crate/application", 7]');
  render(<ReviewPage review={walked} />);
  await screen.findByRole('group', { name: 'rust' });

  expect(readRows()).toEqual([]);
});

test.for([
  { stored: undefined, rows: ['1 application'], why: 'nothing stored' },
  { stored: '["rust/crate/legacy"]', rows: ['3 legacy'], why: 'marks stored' },
  { stored: '[]', rows: [], why: 'every mark taken off' },
  { stored: 'not json', rows: ['1 application'], why: 'a corrupt store' },
])('on a later round with $why, the parts ticked at first are $rows', async ({ stored, rows }) => {
  const walked = {
    ...walkedReview(),
    sinceReview: { ...sinceReview, stillRead: ['rust/crate/application'] },
  };
  if (stored !== undefined) localStorage.setItem(`visual-review:read:${walked.range}`, stored);
  render(<ReviewPage review={walked} />);
  await screen.findByRole('group', { name: 'rust' });

  expect(readRows()).toEqual(rows);
});

test('J, K and A act on Structure alone: on Metrics and Tests they neither walk nor mark', async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={walkedReview()} />);
  await screen.findByRole('group', { name: 'rust' });
  await user.keyboard('j');

  await user.click(screen.getByRole('link', { name: 'Metrics' }));
  await waitFor(() => expect(currentTab()).toBe('Metrics'));
  await user.keyboard('ja');
  await user.click(screen.getByRole('link', { name: /^Tests/ }));
  await waitFor(() => expect(currentTab()).toMatch(/^Tests/));
  await user.keyboard('ja');
  await user.click(screen.getByRole('link', { name: 'Structure' }));
  await screen.findByRole('group', { name: 'rust' });

  expect(selectedPart()).toBe('application');
  expect(within(readingOrder()).getByText('0 of 3 parts read')).toBeDefined();
});

test('J, K and A in capitals, with Caps Lock or Shift, walk and mark as in lower case', async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={walkedReview()} />);
  await screen.findByRole('group', { name: 'rust' });

  await user.keyboard('JJKA');
  expect(selectedPart()).toBe('application');
  expect(readRows()).toEqual(['1 application']);
});

test('J, K and A held with Control, Meta or Alt are left to the browser, neither walking nor marking', async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={walkedReview()} />);
  await screen.findByRole('group', { name: 'rust' });

  await user.keyboard('j');
  await user.keyboard('{Control>}j{/Control}{Meta>}a{/Meta}{Alt>}j{/Alt}');
  expect(selectedPart()).toBe('application');
  expect(within(readingOrder()).getByText('0 of 3 parts read')).toBeDefined();
});

test('J, K and A typed in a comment are text, neither walking nor marking', async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={walkedReview()} send={async () => {}} />);
  await screen.findByRole('group', { name: 'rust' });

  await user.keyboard('j');
  await user.type(within(noteTab()).getByRole('textbox', { name: 'Your comment' }), 'jaj');
  expect(selectedPart()).toBe('application');
  expect(within(readingOrder()).getByText('0 of 3 parts read')).toBeDefined();
  expect(within(noteTab()).getByRole('textbox', { name: 'Your comment' })).toHaveProperty(
    'value',
    'jaj',
  );
});

test('J walks the reading order with the All edges box focused', async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={walkedReview()} />);
  await screen.findByRole('group', { name: 'rust' });

  await user.click(screen.getByRole('checkbox', { name: 'All edges' }));
  await user.keyboard('j');
  expect(selectedPart()).toBe('application');
});

test("J, K and A typed in why it's fine are text, neither walking nor marking", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={{ ...walkedReview(), findings: [findingOn('rust/crate/application')] }}
      send={async () => {}}
    />,
  );
  await screen.findByRole('group', { name: 'rust' });

  await user.keyboard('j');
  await user.click(within(noteTab()).getByRole('button', { name: "It's fine" }));
  await user.type(within(noteTab()).getByRole('textbox', { name: "Why it's fine" }), 'jaj');
  expect(selectedPart()).toBe('application');
  expect(within(readingOrder()).getByText('0 of 3 parts read')).toBeDefined();
  expect(within(noteTab()).getByRole('textbox', { name: "Why it's fine" })).toHaveProperty(
    'value',
    'jaj',
  );
});

test('Start here lists its lines in rank order, in the dimension a triage chip picks, folding to its title, each going to its node, five at most with All findings opening the rail, and is absent with no findings', async () => {
  const user = userEvent.setup();
  const flagged = (target: string, overrides: Partial<Finding>) =>
    findingOn(target, { check: 'flag', level: 'look', ...overrides });
  const { rerender } = render(
    <ReviewPage
      review={pageWith({
        ...review,
        findings: [
          findingOn('rust/crate/application'),
          flagged('rust/crate/domain', { id: 'b', title: 'second' }),
          flagged('rust/crate/cli-adapter', { id: 'a', title: 'first' }),
          flagged('rust/crate/application', { id: 'c', dimension: 'routes', title: 'third' }),
        ],
      })}
    />,
  );

  const band = () => within(screen.getByRole('region', { name: 'Start here' }));
  await screen.findByRole('region', { name: 'Start here' });
  const items = () =>
    band()
      .getAllByRole('listitem')
      .map(item => within(item).getByRole('button').getAttribute('aria-label'));
  expect(items()).toEqual([
    'cli-adapter: first',
    'domain: second',
    'application: third',
    'application: lines 900, over 800',
  ]);
  expect(band().getByText('3 findings need a look')).toBeDefined();
  const routes = () =>
    within(screen.getByRole('group', { name: 'Triage' })).getByRole('button', { name: /Routes/ });
  await user.click(routes());
  expect(items()).toEqual(['application: third']);
  await user.click(routes());
  expect(items()).toHaveLength(4);
  const toggle = () => band().getByRole('button', { name: 'Start here' });
  expect(toggle().getAttribute('aria-expanded')).toBe('true');
  await user.click(toggle());
  expect(band().queryAllByRole('listitem')).toHaveLength(0);
  expect(band().getByText('3 findings need a look')).toBeDefined();
  expect(toggle().getAttribute('aria-expanded')).toBe('false');
  await user.click(toggle());
  expect(items()).toHaveLength(4);
  await user.click(band().getByRole('button', { name: 'domain: second' }));
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'domain: unchanged' })),
  );

  const flags = Array.from({ length: 6 }, (_, index) =>
    flagged('rust/crate/domain', { id: `look ${index}`, title: `${index}` }),
  );
  rerender(<ReviewPage review={pageWith({ ...review, findings: flags })} />);
  expect(items()).toEqual(['0', '1', '2', '3', '4'].map(title => `domain: ${title}`));
  expect(screen.queryByRole('complementary', { name: 'Findings' })).toBeNull();
  await user.click(band().getByRole('button', { name: 'All findings' }));
  expect(screen.getByRole('complementary', { name: 'Findings' })).toBeDefined();
  await user.click(screen.getByRole('button', { name: 'Hide findings' }));

  rerender(<ReviewPage review={pageWith({ ...review, findings: [] })} />);
  expect(screen.queryByRole('region', { name: 'Start here' })).toBeNull();
});

test('with nothing to look at, Start here says so and still shows what is for information', async () => {
  render(
    <ReviewPage review={pageWith({ ...review, findings: [findingOn('rust/crate/domain')] })} />,
  );

  const band = within(await screen.findByRole('region', { name: 'Start here' }));
  expect(band.getByText('nothing needs a look · 1 finding')).toBeDefined();
  expect(band.getByRole('button', { name: 'domain: lines 900, over 800' })).toBeDefined();
});

const webModule = (label: string, state: Diffed = 'unchanged') => ({
  id: `web/module/${label}`,
  kind: 'module' as const,
  label,
  parent: 'web',
  path: `web/src/${label}`,
  state,
});

const webFile = (module: string, label: string, state: Diffed = 'unchanged') => ({
  id: `web/file/${module}/${label}`,
  kind: 'file' as const,
  label,
  parent: `web/module/${module}`,
  path: `web/src/${module}/${label}`,
  state,
});

const webImport = (from: string, to: string, state: GraphDiff['edges'][number]['state']) => ({
  from: `web/file/${from}`,
  to: `web/file/${to}`,
  state,
});

const buttonsIn = (element: HTMLElement) =>
  within(element)
    .getAllByRole('button')
    .map(drawn => drawn.getAttribute('aria-label'));

const webFilesReview = (count: number) => ({
  range: 'abc123..def456',
  diff: {
    nodes: [
      { id: 'web', kind: 'stack' as const, label: 'web', path: '', state: 'unchanged' as const },
      webModule('utils', 'modified'),
      ...Array.from({ length: count }, (_, at) => webFile('utils', `${at}.ts`, 'modified')),
    ],
    edges: [],
  },
});

const findingsOnFiles = (
  { count, files }: { readonly count: number; readonly files: number },
  overrides: Partial<Finding>,
) =>
  Array.from({ length: count }, (_, at) =>
    findingOn(`web/file/utils/${at % files}.ts`, {
      id: `${overrides.check}:${at}`,
      title: `said ${at}`,
      ...overrides,
    }),
  );

test("a check's findings read as one line, which opens in place to list them, unanswered, each going to its target", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        ...webFilesReview(9),
        findings: [
          ...findingsOnFiles({ count: 7, files: 4 }, { check: 'api:signature', level: 'look' }),
          ...findingsOnFiles({ count: 30, files: 9 }, { check: 'api:added', level: 'info' }),
        ],
      })}
      send={vi.fn()}
    />,
  );

  const band = within(await screen.findByRole('region', { name: 'Start here' }));
  const signatures = () =>
    band.getByRole('button', { name: '7 exported signatures changed · 4 files' });
  expect(band.getByRole('button', { name: '30 exported symbols added · 9 files' })).toBeDefined();
  expect(signatures().getAttribute('aria-expanded')).toBe('false');
  expect(band.queryByRole('button', { name: '1.ts: said 1' })).toBeNull();

  await user.click(signatures());

  expect(signatures().getAttribute('aria-expanded')).toBe('true');
  expect(band.getAllByRole('button', { name: /: said \d$/ })).toHaveLength(7);
  expect(band.queryByRole('group', { name: 'Answer' })).toBeNull();
  await user.click(band.getByRole('button', { name: '1.ts: said 1' }));
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '1.ts: modified' })),
  );

  await user.click(signatures());
  expect(band.queryByRole('button', { name: '1.ts: said 1' })).toBeNull();
});

test("modules open collapsed, joined by their files' imports; a module's toggle expands it into its files and back; a note on a hidden import shows on the edge it merges into; a summary item on a hidden file or a rail finding on a hidden import expands what hides it and focuses it, without pulling focus back later", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        range: 'abc123..def456',
        diff: {
          nodes: [
            { id: 'rust', kind: 'stack', label: 'rust', path: '', state: 'unchanged' },
            crate('domain', 'unchanged'),
            crate('application', 'unchanged'),
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
            webModule('modules/AppInfo'),
            webModule('utils', 'modified'),
            webFile('modules/AppInfo', 'api/app-info.ts'),
            webFile('modules/AppInfo', 'AppInfo.tsx'),
            webFile('utils', 'x.ts', 'modified'),
            webFile('utils', 'y.ts'),
          ],
          edges: [
            dependency('application', 'domain', 'unchanged'),
            {
              from: 'web/file/modules/AppInfo/api/app-info.ts',
              to: 'web/file/utils/x.ts',
              state: 'added',
            },
            {
              from: 'web/file/modules/AppInfo/AppInfo.tsx',
              to: 'web/file/utils/x.ts',
              state: 'added',
            },
          ],
        },
      })}
      notes={{
        version: 1,
        tests: '',
        summary: [{ text: 'Check y.ts', target: 'web/file/utils/y.ts' }],
        notes: {
          'web/file/modules/AppInfo/api/app-info.ts -> web/file/utils/x.ts': {
            text: 'New helper.',
            flag: 'reaches into utils',
          },
          'web/file/utils/y.ts': { text: 'Untouched, but read it.' },
        },
      }}
    />,
  );

  await showEverything(user);
  const web = await screen.findByRole('group', { name: 'web' });
  expect(screen.queryByRole('region', { name: 'Unplaced notes' })).toBeNull();
  const collapsed = [
    'modules/AppInfo → utils: added, flagged: reaches into utils',
    'modules/AppInfo: unchanged',
    'Expand modules/AppInfo',
    'utils: modified',
    'Expand utils',
  ];
  expect(buttonsIn(web)).toEqual(collapsed);
  expect(buttonsIn(await screen.findByRole('group', { name: 'rust' }))).toEqual([
    'application → domain: unchanged',
    'domain: unchanged',
    'application: unchanged',
  ]);
  await user.click(within(web).getByRole('button', { name: /^modules\/AppInfo → utils/ }));
  expect(noteShown()).toBe('New helper.');

  await user.click(within(web).getByRole('button', { name: 'Expand utils' }));

  const utils = await within(web).findByRole('group', { name: 'utils' });
  expect(buttonsIn(utils)).toEqual(['x.ts: modified', 'y.ts: unchanged']);
  expect(
    within(web).getByRole('button', {
      name: 'modules/AppInfo → x.ts: added, flagged: reaches into utils',
    }),
  ).toBeTruthy();
  const collapse = within(web).getByRole('button', { name: 'Collapse utils' });
  expect(collapse.getAttribute('aria-expanded')).toBe('true');

  await user.click(collapse);

  await waitFor(() => expect(buttonsIn(web)).toEqual(collapsed));
  expect(
    within(web).getByRole('button', { name: 'Expand utils' }).getAttribute('aria-expanded'),
  ).toBe('false');

  await user.click(screen.getByRole('button', { name: 'Check y.ts' }));

  const y = await within(web).findByRole('button', { name: 'y.ts: unchanged' });
  await waitFor(() => expect(document.activeElement).toBe(y));
  expect(noteShown()).toBe('Untouched, but read it.');

  await user.click(within(web).getByRole('button', { name: 'Expand modules/AppInfo' }));

  await within(web).findByRole('group', { name: 'modules/AppInfo' });
  expect(document.activeElement).not.toBe(y);

  await user.click(within(web).getByRole('button', { name: 'Collapse modules/AppInfo' }));
  await waitFor(() =>
    expect(within(web).queryByRole('group', { name: 'modules/AppInfo' })).toBeNull(),
  );
  await user.click(within(web).getByRole('button', { name: 'Collapse utils' }));
  await waitFor(() => expect(within(web).queryByRole('group', { name: 'utils' })).toBeNull());
  await user.click(screen.getByRole('button', { name: /^Show \d+ findings?$/ }));
  await user.click(
    within(screen.getByRole('complementary', { name: 'Findings' })).getByRole('button', {
      name: /: reaches into utils$/,
    }),
  );

  const reaching = await within(web).findByRole('button', {
    name: 'api/app-info.ts → x.ts: added, flagged: reaches into utils',
  });
  await waitFor(() => expect(document.activeElement).toBe(reaching));
  expect(noteShown()).toBe('New helper.');
});

test("with 'All edges' unticked, an unchanged import between two open modules is drawn module to module unless it has a note; ticking it draws every import; going to a merged import from the summary ticks it", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        range: 'abc123..def456',
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
      })}
      notes={{
        version: 1,
        tests: '',
        summary: [
          {
            text: 'See checkout.',
            target: 'web/file/orders/checkout.ts -> web/file/billing/invoice.ts',
          },
        ],
        notes: {
          'web/file/orders/cart.ts -> web/file/billing/invoice.ts': { text: 'Totals.' },
        },
      }}
    />,
  );
  await showEverything(user);
  const web = await screen.findByRole('group', { name: 'web' });
  const all = screen.getByRole('checkbox', { name: 'All edges' });
  expect(all).toHaveProperty('checked', false);
  await user.click(within(web).getByRole('button', { name: 'Expand orders' }));
  await user.click(within(web).getByRole('button', { name: 'Expand billing' }));
  await within(web).findByRole('group', { name: 'billing' });

  const imports = () => buttonsIn(web).filter(name => name?.includes('→'));
  await waitFor(() =>
    expect(imports()).toEqual(['cart.ts → invoice.ts: unchanged', 'orders → billing: unchanged']),
  );

  await user.click(all);

  await waitFor(() =>
    expect(imports()).toEqual([
      'cart.ts → invoice.ts: unchanged',
      'checkout.ts → invoice.ts: unchanged',
    ]),
  );

  await user.click(all);
  await waitFor(() => expect(imports()).toContain('orders → billing: unchanged'));
  await user.click(screen.getByRole('button', { name: 'See checkout.' }));

  expect(all).toHaveProperty('checked', true);
  await waitFor(() =>
    expect(document.activeElement).toBe(
      within(web).getByRole('button', { name: 'checkout.ts → invoice.ts: unchanged' }),
    ),
  );
});

test('a served page offers no comment on an edge drawn between closed modules, which stands for imports and is none of them, and says to open its ends', async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        range: 'abc123..def456',
        diff: {
          nodes: [
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
            webModule('orders'),
            webModule('billing'),
            webFile('orders', 'cart.ts'),
            webFile('billing', 'invoice.ts'),
          ],
          edges: [webImport('orders/cart.ts', 'billing/invoice.ts', 'unchanged')],
        },
      })}
      send={async () => {}}
    />,
  );
  await showEverything(user);
  const web = await screen.findByRole('group', { name: 'web' });
  const comment = () => within(noteTab()).queryByRole('textbox', { name: 'Your comment' });

  await user.click(within(web).getByRole('button', { name: 'orders: unchanged' }));
  expect(comment()).not.toBeNull();
  await user.click(within(web).getByRole('button', { name: 'orders → billing: unchanged' }));

  expect(comment()).toBeNull();
  expect(within(noteTab()).getByText(/open its ends/)).not.toBeNull();
});

test("with 'Changed + 1 hop' shown, going to a merged module edge or to a hidden import near a change keeps it shown", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        range: 'abc123..def456',
        diff: {
          nodes: [
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
            webModule('orders', 'modified'),
            webModule('billing'),
            webFile('orders', 'cart.ts'),
            webFile('orders', 'checkout.ts'),
            webFile('billing', 'invoice.ts'),
          ],
          edges: [
            webImport('orders/cart.ts', 'billing/invoice.ts', 'added'),
            webImport('orders/checkout.ts', 'orders/cart.ts', 'added'),
            webImport('orders/checkout.ts', 'billing/invoice.ts', 'unchanged'),
          ],
        },
      })}
      notes={{
        version: 1,
        tests: '',
        summary: [
          { text: 'See the coupling.', target: 'web/module/orders -> web/module/billing' },
          {
            text: 'See checkout.',
            target: 'web/file/orders/checkout.ts -> web/file/billing/invoice.ts',
          },
        ],
        notes: {},
      }}
    />,
  );
  const web = await screen.findByRole('group', { name: 'web' });
  await user.click(within(web).getByRole('button', { name: 'Expand orders' }));
  await user.click(await within(web).findByRole('button', { name: 'Expand billing' }));
  await within(web).findByRole('group', { name: 'billing' });
  await user.click(shown('Changed + 1 hop'));

  await user.click(screen.getByRole('button', { name: 'See the coupling.' }));

  expect(shown('Changed + 1 hop').getAttribute('aria-pressed')).toBe('true');

  await user.click(screen.getByRole('button', { name: 'See checkout.' }));

  expect(screen.getByRole('checkbox', { name: 'All edges' })).toHaveProperty('checked', true);
  expect(shown('Changed + 1 hop').getAttribute('aria-pressed')).toBe('true');
});

test("web calls to API routes are drawn between the stacks, named by their paths, merged while their module is collapsed and split by file once it's expanded; a call with no route marks the node holding it", async () => {
  const user = userEvent.setup();
  const call = (file: string, path: string, state: GraphDiff['edges'][number]['state']) => ({
    from: `web/file/modules/AppInfo/${file}`,
    to: 'rust/crate/http-adapter',
    via: [path],
    state,
  });
  render(
    <ReviewPage
      review={pageWith({
        range: 'abc123..def456',
        diff: {
          nodes: [
            { id: 'rust', kind: 'stack', label: 'rust', path: '', state: 'unchanged' },
            crate('http-adapter', 'unchanged'),
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
            webModule('modules/AppInfo'),
            webFile('modules/AppInfo', 'api/app-info.ts'),
            webFile('modules/AppInfo', 'api/users.ts'),
          ],
          edges: [
            call('api/app-info.ts', '/api/info', 'removed'),
            call('api/users.ts', '/api/users', 'added'),
          ],
        },
        dangling: [{ from: 'web/file/modules/AppInfo/api/users.ts', path: '/api/app-info' }],
        findings: [
          findingOn('web/file/modules/AppInfo/api/users.ts', {
            id: 'routes:dangling:web/file/modules/AppInfo/api/users.ts',
            dimension: 'routes',
            title: '1 call with no route',
            detail: '/api/app-info',
          }),
        ],
      })}
      notes={{
        version: 1,
        tests: '',
        summary: [],
        notes: {
          'web/file/modules/AppInfo/api/users.ts -> rust/crate/http-adapter': {
            text: 'Lists users.',
          },
        },
      }}
    />,
  );

  await showEverything(user);
  const web = await screen.findByRole('group', { name: 'web' });
  expect(buttonsIn(web)).toEqual([
    'modules/AppInfo: unchanged, no route for /api/app-info',
    'Expand modules/AppInfo',
  ]);
  await user.click(
    screen.getByRole('img', {
      name: 'for information, 1 finding: 1 call with no route: /api/app-info',
    }),
  );
  expect(findingsShown()).toEqual(['1 call with no route: /api/app-info']);
  expect(buttonsIn(screen.getByRole('group', { name: 'rust' }))).toEqual([
    'http-adapter: unchanged',
  ]);
  expect(
    screen.getByRole('button', {
      name: 'modules/AppInfo ⇢ http-adapter: unchanged (/api/info, /api/users)',
    }),
  ).toBeTruthy();

  await user.click(within(web).getByRole('button', { name: 'Expand modules/AppInfo' }));

  expect(
    await screen.findByRole('button', {
      name: 'api/app-info.ts ⇢ http-adapter: removed (/api/info)',
    }),
  ).toBeTruthy();
  expect(buttonsIn(within(web).getByRole('group', { name: 'modules/AppInfo' }))).toEqual([
    'api/app-info.ts: unchanged',
    'api/users.ts: unchanged, no route for /api/app-info',
  ]);
  await user.click(
    screen.getByRole('button', { name: 'api/users.ts ⇢ http-adapter: added (/api/users)' }),
  );
  expect(noteShown()).toBe('Lists users.');
});

const metricCells = (metric: string) => {
  const panel = screen.getByRole('tabpanel', { name: 'Metrics' });
  const header = within(panel)
    .getAllByRole('rowheader')
    .find(cell => cell.textContent?.startsWith(metric));
  const row = within(panel)
    .getAllByRole('row')
    .find(row => header !== undefined && row.contains(header));
  return (
    row &&
    within(row)
      .getAllByRole('cell')
      .map(cell => cell.textContent)
  );
};

test("a measured node's Metrics tab gives each measure before and after with the difference, a missing side and its difference as —, and a side without complexity as not measured, and a box's values as the highest inside it, with no functions listed without their cyclomatic; a node or an edge without metrics has no Metrics tab", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        metrics: {
          'rust/crate/application': {
            base: measured({ fanIn: 2 }),
            head: measured({
              lines: 184,
              functions: 9,
              cyclomatic: { highest: 14, total: 41 },
              abc: 31.5,
              fanOut: 5,
            }),
          },
          'rust/crate/cli-adapter': { head: { churn: 1, fanIn: 0, fanOut: 1 } },
          'rust/crate/legacy': { highestInside: true, base: measured() },
        },
      })}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'application: modified' }));
  expect(inspectorTabs()).toEqual(['Note', 'Metrics']);
  await user.click(within(inspector()).getByRole('tab', { name: 'Metrics' }));
  expect(metricCells('Lines')).toEqual(['120', '184', '+64']);
  expect(metricCells('Functions')).toEqual(['6', '9', '+3']);
  expect(metricCells('Cyclomatic, highest')).toEqual(['4', '14', '+10']);
  expect(metricCells('Cyclomatic, total')).toEqual(['19', '41', '+22']);
  expect(metricCells('ABC size')).toEqual(['18.2', '31.5', '+13.3']);
  expect(metricCells('Fan-out')).toEqual(['3', '5', '+2']);
  expect(metricCells('Fan-in')).toEqual(['2', '1', '−1']);
  expect(metricCells('Churn')).toEqual(['6', '6', '±0']);
  expect(within(inspector()).queryByText(/highest inside/)).toBeNull();
  expect(screen.queryByRole('list', { name: 'Functions by cyclomatic' })).toBeNull();

  await user.click(screen.getByRole('button', { name: 'cli-adapter: added' }));
  expect(metricCells('Lines')).toEqual(['—', 'not measured', '—']);
  expect(metricCells('Fan-out')).toEqual(['—', '1', '—']);
  await user.click(screen.getByRole('button', { name: 'legacy: removed' }));
  expect(metricCells('Lines')).toEqual(['120', '—', '—']);
  expect(within(inspector()).getByText(/highest inside/)).toBeTruthy();

  await user.click(screen.getByRole('button', { name: 'domain: unchanged' }));
  expect(inspectorTabs()).toEqual(['Note']);
  await user.click(screen.getByRole('button', { name: 'application → domain: unchanged' }));
  expect(inspectorTabs()).toEqual(['Note']);
});

const metricMarks = (metric: string) => {
  const header = within(screen.getByRole('tabpanel', { name: 'Metrics' }))
    .getAllByRole('rowheader')
    .find(cell => cell.textContent?.startsWith(metric));
  return (
    header &&
    within(header)
      .queryAllByRole('img')
      .map(mark => mark.getAttribute('aria-label'))
  );
};

test("a Metrics row is marked by the level of the node's finding on it, a hotspot marking Churn", async () => {
  const user = userEvent.setup();
  const application = 'rust/crate/application';
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        metrics: {
          'rust/crate/domain': { head: measured({ cyclomatic: { highest: 20, total: 20 } }) },
          [application]: {
            base: measured({ lines: 850, cyclomatic: { highest: 14, total: 30 }, abc: 31.5 }),
            head: measured({ lines: 900, cyclomatic: { highest: 14, total: 30 }, abc: 31.5 }),
          },
        },
        thresholds: {
          cyclomatic: 10,
          splitParts: 4,
          hotspot: { churn: 5, cyclomatic: 10 },
          lines: 800,
          abc: 30,
        },
      })}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'application: modified' }));
  await user.click(within(inspector()).getByRole('tab', { name: 'Metrics' }));
  expect(metricMarks('Cyclomatic, highest')).toEqual(['for information']);
  expect(metricMarks('ABC size')).toEqual(['for information']);
  expect(metricMarks('Churn')).toEqual(['for information']);
  expect(metricMarks('Lines')).toEqual(['needs a look']);
  expect(metricMarks('Functions')).toEqual([]);
});

test("a measured file's Metrics tab lists its functions by cyclomatic base → head, a repeated name paired n-th with n-th, marked added, removed or modified, the highest head first and removed ones last", async () => {
  const user = userEvent.setup();
  const byFunction = (pairs: ReadonlyArray<readonly [string, number]>) => ({
    highest: 14,
    total: 40,
    byFunction: pairs.map(([name, cyclomatic]) => ({ name, cyclomatic })),
  });
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        metrics: {
          'rust/crate/application': {
            base: measured({
              cyclomatic: byFunction([
                ['refund_order', 4],
                ['validate', 3],
                ['legacy', 5],
                ['helper', 2],
                ['helper', 7],
              ]),
            }),
            head: measured({
              cyclomatic: byFunction([
                ['validate', 3],
                ['refund_order', 14],
                ['helper', 2],
                ['split', 6],
                ['helper', 9],
              ]),
            }),
          },
        },
      })}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'application: modified' }));
  await user.click(within(inspector()).getByRole('tab', { name: 'Metrics' }));
  const functions = screen.getByRole('list', { name: 'Functions by cyclomatic' });
  expect(
    within(functions)
      .getAllByRole('listitem')
      .map(item => item.textContent),
  ).toEqual([
    '~ refund_order 4 → 14',
    '~ helper 7 → 9',
    '+ split — → 6',
    'validate 3 → 3',
    'helper 2 → 2',
    '− legacy 5 → —',
  ]);
});

test("a selected node's Diff tab lists the patches of the files under it from their first hunk, a module's closed and a file's open with its added and removed lines marked, and stays picked from one selection to the next; a file without a patch or an edge has no Diff tab and shows its Note", async () => {
  const user = userEvent.setup();
  const patch = [
    'diff --git a/web/src/utils/x.ts b/web/src/utils/x.ts',
    '--- a/web/src/utils/x.ts',
    '+++ b/web/src/utils/x.ts',
    '@@ -1,2 +1,2 @@ export const y',
    ' export const y = 0;',
    '-export const x = 1;',
    '+export const x = 2;',
  ].join('\n');
  render(
    <ReviewPage
      review={pageWith({
        range: 'abc123..def456',
        diff: {
          nodes: [
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
            webModule('utils', 'modified'),
            webFile('utils', 'x.ts', 'modified'),
            webFile('utils', 'y.ts'),
          ],
          edges: [{ from: 'web/file/utils/y.ts', to: 'web/file/utils/x.ts', state: 'unchanged' }],
        },
        patches: [{ path: 'web/src/utils/x.ts', patch }],
      })}
    />,
  );
  const changes = () => screen.queryByRole('region', { name: 'Changes' });
  const fileShown = () =>
    within(screen.getByRole('region', { name: 'Changes' })).getByRole('group', {
      name: 'web/src/utils/x.ts',
    });

  const web = await screen.findByRole('group', { name: 'web' });
  await showEverything(user);
  await user.click(within(web).getByRole('button', { name: 'utils: modified' }));
  expect(inspectorTabs()).toEqual(['Note', 'Diff']);
  expect(changes()).toBeNull();
  await user.click(within(inspector()).getByRole('tab', { name: 'Diff' }));
  expect(fileShown().hasAttribute('open')).toBe(false);

  await user.click(within(web).getByRole('button', { name: 'Expand utils' }));
  const utils = await within(web).findByRole('group', { name: 'utils' });
  await user.click(within(utils).getByRole('button', { name: 'x.ts: modified' }));
  expect(within(inspector()).getByRole('tab', { selected: true }).textContent).toBe('Diff');
  const file = fileShown();
  expect(file.hasAttribute('open')).toBe(true);
  expect(within(file).getByText(/^@@ -1,2 \+1,2 @@/)).not.toBeNull();
  expect(within(file).queryByText('+++ b/web/src/utils/x.ts')).toBeNull();
  expect(
    within(file)
      .getAllByRole('insertion')
      .map(line => line.textContent),
  ).toEqual(['+export const x = 2;']);
  expect(
    within(file)
      .getAllByRole('deletion')
      .map(line => line.textContent),
  ).toEqual(['-export const x = 1;']);

  await user.click(within(utils).getByRole('button', { name: 'y.ts: unchanged' }));
  expect(inspectorTabs()).toEqual(['Note']);
  expect(changes()).toBeNull();
  expect(noteShown()).toBe('No note');

  await user.click(within(utils).getByRole('button', { name: 'x.ts: modified' }));
  await user.click(within(inspector()).getByRole('tab', { name: 'Diff' }));
  expect(changes()).not.toBeNull();
  await user.click(within(web).getByRole('button', { name: 'y.ts → x.ts: unchanged' }));
  expect(inspectorTabs()).toEqual(['Note']);
  expect(changes()).toBeNull();
});

test("the rail's changed files outside the graph open in the inspector at the changes' width, each a closed patch that opens on click, until a node is selected or the inspector closed, which hands the keyboard focus back to the rail's button", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        undrawn: [
          { path: 'README.md', patch: '--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-old\n+new' },
          { path: 'docs/a.md', patch: '--- a/docs/a.md\n+++ b/docs/a.md\n@@ -1 +1 @@\n-a\n+b' },
        ],
        findings: [
          {
            id: 'structure:undrawn',
            check: 'structure:undrawn',
            dimension: 'structure',
            level: 'info',
            title: '2 changed files outside the graph',
            detail: 'README.md, docs/a.md',
          },
        ],
      })}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'Show 1 finding' }));
  const outside = 'README.md, docs/a.md: 2 changed files outside the graph';
  await user.click(
    within(screen.getByRole('complementary', { name: 'Findings' })).getByRole('button', {
      name: outside,
    }),
  );
  expect(within(inspector()).getByRole('heading', { level: 2 }).textContent).toBe(
    'Changed files outside the graph',
  );
  expect(panelWidth()).toBe('600');
  const readme = within(inspector()).getByRole('group', { name: 'README.md' });
  expect(within(inspector()).getByRole('group', { name: 'docs/a.md' })).toBeDefined();
  expect(readme.hasAttribute('open')).toBe(false);
  await user.click(within(readme).getByText('README.md'));
  expect(within(readme).getByRole('insertion').textContent).toBe('+new');

  await user.click(await screen.findByRole('button', { name: 'domain: unchanged' }));
  expect(within(inspector()).getByRole('heading', { level: 2 }).textContent).toBe('domain');

  const opener = within(screen.getByRole('complementary', { name: 'Findings' })).getByRole(
    'button',
    { name: outside },
  );
  await user.click(opener);
  await user.click(within(inspector()).getByRole('button', { name: 'Close inspector' }));
  expect(screen.queryByRole('complementary', { name: 'Inspector' })).toBeNull();
  expect(document.activeElement).toBe(opener);
});

test("a renamed node shows the label it had under its own, also once expanded, is named with both and its old path, and its inspector's head names it with its kind, stack, state and path and what it was renamed from; a node whose label stayed shows no former one", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        range: 'abc123..def456',
        diff: {
          nodes: [
            { id: 'rust', kind: 'stack', label: 'rust', path: '', state: 'unchanged' },
            {
              ...crate('models', 'modified'),
              renamedFrom: 'crates/domain',
              formerLabel: 'domain',
            },
            {
              id: 'rust/mod/models/lib.rs',
              kind: 'file',
              label: 'lib.rs',
              parent: 'rust/crate/models',
              path: 'crates/models/src/lib.rs',
              state: 'modified',
              renamedFrom: 'crates/domain/src/lib.rs',
            },
          ],
          edges: [],
        },
      })}
    />,
  );

  const rust = await screen.findByRole('group', { name: 'rust' });
  const models = within(rust).getByRole('button', {
    name: 'models: modified, was domain, renamed from crates/domain',
  });
  expect(within(models).getByText('was domain')).not.toBeNull();

  await user.click(models);
  expect(within(inspector()).getByRole('heading', { level: 2 }).textContent).toBe('models');
  expect(within(inspector()).getByText('package · rust')).not.toBeNull();
  expect(within(inspector()).getByText('modified')).not.toBeNull();
  expect(within(inspector()).getByText('crates/models, renamed from crates/domain')).not.toBeNull();

  await user.click(within(rust).getByRole('button', { name: 'Expand models' }));
  const expanded = await within(rust).findByRole('group', { name: 'models' });
  expect(within(expanded).getByText('was domain')).not.toBeNull();
  const lib = within(expanded).getByRole('button', { name: /^lib\.rs: modified/ });
  expect(within(lib).queryByText(/was/)).toBeNull();
  await user.click(lib);
  expect(within(inspector()).getByText('file · rust')).not.toBeNull();
  expect(
    within(inspector()).getByText(
      'crates/models/src/lib.rs, renamed from crates/domain/src/lib.rs',
    ),
  ).not.toBeNull();
});

test('the Tests tab lists each changed test file with its tests as a tree, each named with its change and any label or where it moved, an unreadable one with the reason and a renamed one with its old path', () => {
  atHash('#tests');
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        tests: [
          {
            path: 'tools/visual-review/src/notes.test.ts',
            stack: 'tools/visual-review',
            renamedFrom: 'tools/visual-review/src/review-notes.test.ts',
            statements: [
              { kind: 'test', name: 'reads the notes', change: 'edited' },
              { kind: 'test', name: 'reads renames', change: 'added', label: 'todo' },
              {
                kind: 'test',
                name: 'reads flags',
                change: 'removed',
                movedTo: 'tools/visual-review/src/flags.test.ts',
              },
              {
                kind: 'test',
                name: 'reads a summary',
                change: 'added',
                movedFrom: 'tools/visual-review/src/summary.test.ts',
              },
              {
                kind: 'heading',
                name: 'the notes check',
                label: 'skip',
                children: [
                  { kind: 'test', name: 'accepts notes on crates', change: 'unchanged' },
                  { kind: 'test', name: 'names an unknown id', change: 'added' },
                  { kind: 'test', name: 'lists unplaced notes', change: 'removed' },
                ],
              },
            ],
          },
          {
            path: 'web/src/broken.test.ts',
            stack: 'web',
            unreadable: 'SyntaxError: Unexpected token (2:0)',
          },
        ],
      })}
    />,
  );

  const tests = screen.getByRole('region', { name: 'Test changes' });
  const file = within(tests).getByRole('region', { name: 'tools/visual-review/src/notes.test.ts' });
  expect(within(file).getByRole('listitem', { name: 'reads the notes: edited' })).not.toBeNull();
  expect(within(file).getByRole('listitem', { name: 'reads renames: added, todo' })).not.toBeNull();
  const movedOut = within(file).getByRole('listitem', {
    name: 'reads flags: moved to tools/visual-review/src/flags.test.ts',
  });
  expect(
    within(movedOut).getByText('moved to tools/visual-review/src/flags.test.ts'),
  ).not.toBeNull();
  expect(
    within(file).getByRole('listitem', {
      name: 'reads a summary: moved from tools/visual-review/src/summary.test.ts',
    }),
  ).not.toBeNull();
  const check = within(file).getByRole('listitem', { name: 'the notes check, skip' });
  expect(
    within(check).getByRole('listitem', { name: 'accepts notes on crates: unchanged' }),
  ).not.toBeNull();
  expect(
    within(check).getByRole('listitem', { name: 'names an unknown id: added' }),
  ).not.toBeNull();
  expect(
    within(check).getByRole('listitem', { name: 'lists unplaced notes: removed' }),
  ).not.toBeNull();
  const unreadable = within(tests).getByRole('region', { name: 'web/src/broken.test.ts' });
  expect(within(unreadable).getByText(/SyntaxError: Unexpected token \(2:0\)/)).not.toBeNull();
  expect(
    within(file).getByText(/renamed from tools\/visual-review\/src\/review-notes\.test\.ts/),
  ).not.toBeNull();
  expect(within(unreadable).queryByText(/renamed from/)).toBeNull();
  expect(within(tests).queryByText('No test changed.')).toBeNull();
});

test("the inspector's Tests tab lists the test files at or under the selected node, counting their changed tests, and is left out where none changed", async () => {
  const user = userEvent.setup();
  const testFile = (path: string, stack: string) => ({
    path,
    stack,
    statements: [{ kind: 'test' as const, name: 'reads the notes', change: 'added' as const }],
  });
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        tests: [
          testFile('crates/application/src/lib.rs', 'rust'),
          {
            path: 'crates/application/tests/export.rs',
            stack: 'rust',
            statements: [
              { kind: 'test', name: 'exports a CSV', change: 'removed' },
              {
                kind: 'heading',
                name: 'the export',
                children: [
                  { kind: 'test', name: 'names the columns', change: 'unchanged' },
                  { kind: 'test', name: 'quotes commas', change: 'edited' },
                ],
              },
            ],
          },
          testFile('tools/visual-review/src/notes.test.ts', 'tools/visual-review'),
        ],
      })}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'application: modified' }));
  expect(inspectorTabs()).toEqual(['Note', 'Tests 3']);
  await user.click(within(inspector()).getByRole('tab', { name: 'Tests 3' }));
  expect(
    within(screen.getByRole('tabpanel', { name: 'Tests' }))
      .getAllByRole('region')
      .map(file => file.getAttribute('aria-label')),
  ).toEqual(['crates/application/src/lib.rs', 'crates/application/tests/export.rs']);
  await user.click(screen.getByRole('button', { name: 'application → domain: unchanged' }));
  expect(inspectorTabs()).toEqual(['Note']);
  await user.click(screen.getByRole('button', { name: 'domain: unchanged' }));
  expect(inspectorTabs()).toEqual(['Note']);
});

test("a node's Tests tab also lists the test files named after a file inside it, wherever they sit in its stack", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        range: 'abc123..def456',
        diff: {
          nodes: [
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
            webModule('orders', 'modified'),
            webFile('orders', 'refund.ts', 'modified'),
          ],
          edges: [],
        },
        tests: [
          {
            path: 'web/tests/refund.test.ts',
            stack: 'web',
            statements: [{ kind: 'test', name: 'refunds twice', change: 'added' }],
          },
        ],
      })}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'orders: modified' }));
  await user.click(within(inspector()).getByRole('tab', { name: 'Tests 1' }));
  expect(
    within(screen.getByRole('tabpanel', { name: 'Tests' }))
      .getAllByRole('region')
      .map(file => file.getAttribute('aria-label')),
  ).toEqual(['web/tests/refund.test.ts']);
});

test("a node's Tests tab counts a test moved between two of its files once", async () => {
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
              {
                kind: 'test',
                name: 'exports a CSV',
                change: 'removed',
                movedTo: 'crates/application/tests/export.rs',
              },
            ],
          },
          {
            path: 'crates/application/tests/export.rs',
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

  await user.click(await screen.findByRole('button', { name: 'application: modified' }));
  expect(inspectorTabs()).toEqual(['Note', 'Tests 2']);
});

test("'Changes only' is shown first, hiding a neighbour joined by an unchanged edge; going to a drawn node keeps it, going to a neighbour widens to 'Changed + 1 hop', and going further to 'Everything'", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        range: 'abc123..def456',
        diff: {
          nodes: [
            { id: 'rust', kind: 'stack', label: 'rust', path: '', state: 'unchanged' },
            crate('domain', 'unchanged'),
            crate('application', 'modified'),
            crate('cli-adapter', 'unchanged'),
          ],
          edges: [
            dependency('application', 'domain', 'unchanged'),
            dependency('cli-adapter', 'domain', 'unchanged'),
          ],
        },
      })}
      notes={{
        version: 1,
        tests: '',
        summary: [
          { text: 'Read the use case.', target: 'rust/crate/application' },
          { text: 'See what it uses.', target: 'rust/crate/application -> rust/crate/domain' },
          { text: 'Check the CLI.', target: 'rust/crate/cli-adapter' },
        ],
        notes: {},
      }}
    />,
  );
  const rust = await screen.findByRole('group', { name: 'rust' });
  const pressed = () =>
    within(screen.getByRole('group', { name: 'Show' }))
      .getAllByRole('button', { pressed: true })
      .map(button => button.textContent);
  expect(pressed()).toEqual(['Changes only']);
  expect(buttonsIn(rust)).toEqual(['application: modified']);
  const summary = screen.getByRole('region', { name: 'Summary' });
  await user.click(within(summary).getByRole('button', { name: 'Read the use case.' }));
  expect(pressed()).toEqual(['Changes only']);

  await user.click(within(summary).getByRole('button', { name: 'See what it uses.' }));

  expect(pressed()).toEqual(['Changed + 1 hop']);
  await waitFor(() =>
    expect(buttonsIn(rust)).toEqual([
      'application → domain: unchanged',
      'domain: unchanged',
      'application: modified',
    ]),
  );

  await user.click(within(summary).getByRole('button', { name: 'Check the CLI.' }));

  expect(pressed()).toEqual(['Everything']);
  await waitFor(() =>
    expect(document.activeElement).toBe(
      within(rust).getByRole('button', { name: 'cli-adapter: unchanged' }),
    ),
  );
});

test("with 'Changes only' shown and nothing drawn changed, the graph gives way to a line saying so", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        range: 'abc123..def456',
        diff: {
          nodes: [
            { id: 'rust', kind: 'stack', label: 'rust', path: '', state: 'unchanged' },
            crate('domain', 'unchanged'),
          ],
          edges: [],
        },
      })}
    />,
  );
  expect(await screen.findByText('Nothing in the graph changed.')).toBeTruthy();
  expect(screen.queryByRole('group', { name: 'rust' })).toBeNull();

  await showEverything(user);

  await screen.findByRole('group', { name: 'rust' });
  expect(screen.queryByText('Nothing in the graph changed.')).toBeNull();
});

const withChangesUnderApplication = {
  ...review,
  patches: [
    {
      path: 'crates/application/src/lib.rs',
      patch: [
        'diff --git a/crates/application/src/lib.rs b/crates/application/src/lib.rs',
        '--- a/crates/application/src/lib.rs',
        '+++ b/crates/application/src/lib.rs',
        '@@ -1 +1 @@',
        '-pub mod a;',
        '+pub mod b;',
      ].join('\n'),
    },
  ],
};

const panelWidth = () =>
  screen.getByRole('separator', { name: 'Panel width' }).getAttribute('aria-valuenow');

test('a selected node opens its panel beside a divider that gives its width: 360 for a note alone, 600 with changes; arrow keys move the divider, other keys leave it, and it stops at 280 and where the graph, right of the findings rail, would get narrower than 320; the width it sets holds for later selections and across tabs', async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={pageWith(withChangesUnderApplication)} />);

  const rust = await screen.findByRole('group', { name: 'rust' });
  vi.spyOn(screen.getByRole('group', { name: 'Graph' }), 'getBoundingClientRect').mockReturnValue(
    DOMRect.fromRect({ x: 101, y: 0, width: 600, height: 400 }),
  );
  expect(screen.queryByRole('separator')).toBeNull();

  await user.click(within(rust).getByRole('button', { name: 'application: modified' }));
  expect(panelWidth()).toBe('600');

  await user.click(within(rust).getByRole('button', { name: 'domain: unchanged' }));
  expect(panelWidth()).toBe('360');

  await user.click(screen.getByRole('separator', { name: 'Panel width' }));
  await user.keyboard('{ArrowRight}');
  expect(panelWidth()).toBe('320');
  await user.keyboard('{ArrowRight}');
  expect(panelWidth()).toBe('280');
  await user.keyboard('{ArrowRight}');
  expect(panelWidth()).toBe('280');

  await user.keyboard('{ArrowLeft>6/}');
  expect(panelWidth()).toBe('520');
  await user.keyboard('{ArrowLeft}');
  expect(panelWidth()).toBe('555');
  await user.keyboard('{Tab}');
  expect(panelWidth()).toBe('555');

  await user.click(within(rust).getByRole('button', { name: 'application: modified' }));
  expect(panelWidth()).toBe('555');

  await user.click(screen.getByRole('link', { name: 'Metrics' }));
  await waitFor(() => expect(currentTab()).toBe('Metrics'));
  await user.click(screen.getByRole('link', { name: 'Structure' }));
  await waitFor(() => expect(currentTab()).toBe('Structure'));
  expect(panelWidth()).toBe('555');
});

test('dragging the divider sets the panel width until the button is let go, within the same limits', async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={pageWith(review)} />);
  const rust = await screen.findByRole('group', { name: 'rust' });
  await user.click(within(rust).getByRole('button', { name: 'domain: unchanged' }));
  const divider = screen.getByRole('separator', { name: 'Panel width' });

  await user.pointer([
    { keys: '[MouseLeft>]', target: divider, coords: { clientX: 600 } },
    { coords: { clientX: 450 } },
  ]);
  expect(panelWidth()).toBe('510');
  await user.pointer({ coords: { clientX: 800 } });
  expect(panelWidth()).toBe('280');

  await user.pointer({ keys: '[/MouseLeft]' });
  await user.pointer({ coords: { clientX: 500 } });
  expect(panelWidth()).toBe('280');
  expect(fireEvent.pointerDown(divider, { clientX: 500 }), 'a drag selects no page text').toBe(
    false,
  );
});

const churned = (churn: number) => ({ head: { churn, fanIn: 0, fanOut: 0 } });

const eightCrates = {
  range: 'abc123..def456',
  diff: {
    nodes: [
      { id: 'rust', kind: 'stack' as const, label: 'rust', path: '', state: 'unchanged' as const },
      crate('domain', 'modified'),
      crate('application', 'modified'),
      crate('billing', 'modified'),
      crate('shipping', 'modified'),
      crate('search', 'modified'),
      crate('cli-adapter', 'added'),
      crate('legacy', 'removed'),
      crate('audit', 'modified'),
    ],
    edges: [],
  },
};

const scaleSteps = () =>
  within(screen.getByRole('list', { name: 'Scale' }))
    .getAllByRole('listitem')
    .map(step => step.textContent);

const colourBy = (name: string) =>
  within(screen.getByRole('group', { name: 'Colour by' })).getByRole('button', { name });

test('Colour by starts on Change; on Churn each measured node is named with its churn and the step of the ramp holding it, cut at 3, 6 and 9, a removed node by its base, an unmeasured one with nothing; back on Change they go', async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        ...eightCrates,
        metrics: {
          'rust/crate/domain': { base: { churn: 7, fanIn: 0, fanOut: 0 }, ...churned(2) },
          'rust/crate/cli-adapter': churned(3),
          'rust/crate/billing': churned(5),
          'rust/crate/shipping': churned(6),
          'rust/crate/search': churned(8),
          'rust/crate/application': churned(9),
          'rust/crate/legacy': { base: { churn: 4, fanIn: 0, fanOut: 0 } },
        },
      })}
    />,
  );
  const rust = await screen.findByRole('group', { name: 'rust' });
  expect(colourBy('Change').getAttribute('aria-pressed')).toBe('true');
  expect(colourBy('Churn').getAttribute('aria-pressed')).toBe('false');
  expect(screen.getByRole('list', { name: 'Legend' })).toBeTruthy();
  expect(screen.queryByRole('list', { name: 'Scale' })).toBeNull();

  await user.click(colourBy('Churn'));
  expect(screen.queryByRole('list', { name: 'Legend' })).toBeNull();
  expect(scaleSteps()).toEqual(['0–2', '3–5', '6–8', '9+']);
  expect(colourBy('Churn').getAttribute('aria-pressed')).toBe('true');
  expect(colourBy('Change').getAttribute('aria-pressed')).toBe('false');
  expect(buttonsIn(rust)).toEqual([
    'domain: modified, churn 2 (0–2)',
    'application: modified, churn 9 (9+)',
    'billing: modified, churn 5 (3–5)',
    'shipping: modified, churn 6 (6–8)',
    'search: modified, churn 8 (6–8)',
    'cli-adapter: added, churn 3 (3–5)',
    'legacy: removed, churn 4 (3–5)',
    'audit: modified',
  ]);

  await user.click(colourBy('Change'));
  expect(within(rust).getByRole('button', { name: 'application: modified' })).toBeTruthy();
  expect(screen.getByRole('list', { name: 'Legend' })).toBeTruthy();
  expect(screen.queryByRole('list', { name: 'Scale' })).toBeNull();
});

const complex = (highest: number) => measured({ cyclomatic: { highest, total: highest } });

test("on Complexity each node is named with its head's highest cyclomatic and the step holding it, cut at 5, 8 and 11; a removed node or a head without complexity with nothing", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        ...eightCrates,
        metrics: {
          'rust/crate/domain': { base: complex(12), head: complex(4) },
          'rust/crate/application': { head: complex(5) },
          'rust/crate/billing': { head: complex(7) },
          'rust/crate/shipping': { head: complex(8) },
          'rust/crate/search': { head: complex(10) },
          'rust/crate/cli-adapter': { head: complex(11) },
          'rust/crate/legacy': { base: complex(12) },
          'rust/crate/audit': churned(9),
        },
      })}
    />,
  );
  const rust = await screen.findByRole('group', { name: 'rust' });

  await user.click(colourBy('Complexity'));
  expect(colourBy('Complexity').getAttribute('aria-pressed')).toBe('true');
  expect(scaleSteps()).toEqual(['0–4', '5–7', '8–10', '11+']);
  expect(buttonsIn(rust)).toEqual([
    'domain: modified, cyclomatic 4 (0–4)',
    'application: modified, cyclomatic 5 (5–7)',
    'billing: modified, cyclomatic 7 (5–7)',
    'shipping: modified, cyclomatic 8 (8–10)',
    'search: modified, cyclomatic 10 (8–10)',
    'cli-adapter: added, cyclomatic 11 (11+)',
    'legacy: removed',
    'audit: modified',
  ]);
});

const topFile = (label: string, state: Diffed = 'unchanged') => ({
  id: `web/file/${label}`,
  kind: 'file' as const,
  label,
  parent: 'web',
  path: `web/src/${label}`,
  state,
});

const symbolsOf = (node: string, symbols: ReadonlyArray<SymbolStatement>): SymbolFile => ({
  node,
  stack: 'web',
  symbols,
  exports: { added: [], removed: [] },
  kind: 'logic',
});

test('on Kind of change a changed file is named with the strongest kind of its symbol changes: API change, logic change or formatting only; a changed file with no symbols read as symbols not read, an unchanged one with nothing', async () => {
  const user = userEvent.setup();
  const kinded = (node: string, kind: KindOfChange) => ({ ...symbolsOf(node, []), kind });
  render(
    <ReviewPage
      review={pageWith({
        range: 'abc123..def456',
        diff: {
          nodes: [
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
            topFile('api.ts', 'modified'),
            topFile('logic.ts', 'modified'),
            topFile('format.ts', 'modified'),
            topFile('styles.css', 'modified'),
            topFile('same.ts'),
          ],
          edges: [webImport('api.ts', 'same.ts', 'unchanged')],
        },
        symbols: [
          kinded('web/file/api.ts', 'api'),
          kinded('web/file/logic.ts', 'logic'),
          kinded('web/file/format.ts', 'formatting'),
        ],
      })}
    />,
  );
  const web = await screen.findByRole('group', { name: 'web' });
  await showEverything(user);
  await within(web).findByRole('button', { name: 'same.ts: unchanged' });

  await user.click(colourBy('Kind of change'));
  expect(colourBy('Kind of change').getAttribute('aria-pressed')).toBe('true');
  expect(screen.queryByRole('list', { name: 'Legend' })).toBeNull();
  expect(scaleSteps()).toEqual([
    'API change',
    'logic change',
    'formatting only',
    'symbols not read',
  ]);
  expect(buttonsIn(web)).toEqual([
    'api.ts → same.ts: unchanged',
    'api.ts: modified, API change',
    'logic.ts: modified, logic change',
    'format.ts: modified, formatting only',
    'styles.css: modified, symbols not read',
    'same.ts: unchanged',
  ]);
});

test('on Kind of change a closed box is named with the strongest kind among the files inside it', async () => {
  const user = userEvent.setup();
  const kinded = (node: string, kind: KindOfChange) => ({ ...symbolsOf(node, []), kind });
  render(
    <ReviewPage
      review={pageWith({
        range: 'abc123..def456',
        diff: {
          nodes: [
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
            webModule('checkout', 'modified'),
            webFile('checkout', 'pay.ts', 'modified'),
            webFile('checkout', 'api.ts', 'modified'),
            webModule('cart', 'modified'),
            webFile('cart', 'total.ts', 'modified'),
            webFile('cart', 'line.ts', 'modified'),
          ],
          edges: [],
        },
        symbols: [
          kinded('web/file/checkout/pay.ts', 'logic'),
          kinded('web/file/checkout/api.ts', 'api'),
          kinded('web/file/cart/total.ts', 'formatting'),
          kinded('web/file/cart/line.ts', 'logic'),
        ],
      })}
    />,
  );
  const web = await screen.findByRole('group', { name: 'web' });

  await user.click(colourBy('Kind of change'));
  expect(buttonsIn(web)).toEqual([
    'checkout: modified, API change',
    'Expand checkout',
    'cart: modified, logic change',
    'Expand cart',
  ]);
});

const symbolGroups = () =>
  within(screen.getByRole('tabpanel', { name: 'Symbols' }))
    .getAllByRole('list')
    .filter(list => !list.getAttribute('aria-label')?.startsWith('Signature of'))
    .map(list => [
      list.getAttribute('aria-label'),
      within(list)
        .getAllByRole('listitem')
        .filter(item => item.parentElement === list)
        .map(item => item.getAttribute('aria-label')),
    ]);

test("a file's Symbols tab lists its changed symbols grouped by change, counting them on the tab, its unchanged and formatting-only ones collapsed under a count, and is left out on a node with no symbol changes", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        range: 'abc123..def456',
        diff: {
          nodes: [
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
            topFile('refund.ts', 'modified'),
            topFile('total.ts', 'modified'),
          ],
          edges: [],
        },
        symbols: [
          symbolsOf('web/file/refund.ts', [
            {
              name: 'refund',
              kind: 'function',
              exported: { base: false, head: false },
              change: 'edited',
            },
            { name: 'Refunds', kind: 'class', exported: { head: false }, change: 'added' },
            {
              name: 'void',
              scope: 'Refunds',
              kind: 'method',
              exported: { head: false },
              change: 'added',
            },
            { name: 'cancel', kind: 'function', exported: { base: false }, change: 'removed' },
            {
              name: 'round',
              kind: 'function',
              exported: { base: false, head: false },
              change: 'unchanged',
            },
            {
              name: 'format',
              kind: 'function',
              exported: { base: false, head: false },
              change: 'formatting',
            },
          ]),
        ],
      })}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'refund.ts: modified' }));
  await user.click(within(inspector()).getByRole('tab', { name: 'Symbols 4' }));
  expect(symbolGroups()).toEqual([
    ['Edited', ['function refund: edited']],
    ['Added', ['class Refunds: added', 'method Refunds.void: added']],
    ['Removed', ['function cancel: removed']],
    ['Unchanged', ['function round: unchanged', 'function format: formatting']],
  ]);
  expect(
    within(screen.getByRole('tabpanel', { name: 'Symbols' })).queryAllByRole('region'),
  ).toEqual([]);
  expect(
    within(screen.getByRole('tabpanel', { name: 'Symbols' })).getByText('2 unchanged'),
  ).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'total.ts: modified' }));
  expect(inspectorTabs()).toEqual(['Note']);
});

test("a file's Symbols tab lists its API changes first: exported symbols added, removed, renamed, moved, un-exported or whose signature changed, a changed signature shown base then head, each symbol marked exported, now exported or no longer exported", async () => {
  const user = userEvent.setup();
  const exported = (base?: boolean, head?: boolean) => ({
    ...(base !== undefined && { base }),
    ...(head !== undefined && { head }),
  });
  render(
    <ReviewPage
      review={pageWith({
        range: 'abc123..def456',
        diff: {
          nodes: [
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
            topFile('refund.ts', 'modified'),
          ],
          edges: [],
        },
        symbols: [
          symbolsOf('web/file/refund.ts', [
            {
              name: 'charge',
              kind: 'function',
              exported: exported(true, true),
              change: 'edited',
              signature: { base: 'class Charge extends Base', head: 'class Charge extends Money' },
            },
            { name: 'total', kind: 'function', exported: exported(true, true), change: 'edited' },
            { name: 'old', kind: 'function', exported: exported(true), change: 'removed' },
            { name: 'refund', kind: 'function', exported: exported(true, false), change: 'edited' },
            {
              name: 'tax',
              kind: 'function',
              exported: exported(true),
              change: 'moved',
              movedTo: 'web/file/tax.ts',
            },
            {
              name: 'helper',
              kind: 'function',
              exported: exported(undefined, false),
              change: 'added',
            },
            { name: 'fee', kind: 'function', exported: exported(false, true), change: 'edited' },
            {
              name: 'checkout',
              kind: 'function',
              exported: exported(undefined, true),
              change: 'added',
            },
          ]),
        ],
      })}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'refund.ts: modified' }));
  await user.click(within(inspector()).getByRole('tab', { name: 'Symbols 8' }));
  expect(symbolGroups()).toEqual([
    [
      'API',
      [
        'function charge, exported: edited',
        'function old, exported: removed',
        'function refund, no longer exported: edited',
        'function tax, exported: moved',
        'function fee, now exported: edited',
        'function checkout, exported: added',
      ],
    ],
    ['Edited', ['function total, exported: edited']],
    ['Added', ['function helper: added']],
  ]);
  const charge = screen.getByRole('listitem', { name: 'function charge, exported: edited' });
  expect(within(charge).getByRole('deletion').textContent).toBe('class Charge extends Base');
  expect(within(charge).getByRole('insertion').textContent).toBe('class Charge extends Money');
  const total = screen.getByRole('listitem', { name: 'function total, exported: edited' });
  expect(total.textContent).toBe('function total exported');
  expect(
    screen.getByRole('listitem', { name: 'function refund, no longer exported: edited' })
      .textContent,
  ).toBe('function refund no longer exported');
  expect(screen.getByRole('listitem', { name: 'function helper: added' }).textContent).toBe(
    'function helper',
  );
  expect(within(total).queryByRole('deletion')).toBeNull();
});

const signatureLinesOf = async (signature: { readonly base: string; readonly head: string }) => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        range: 'abc123..def456',
        diff: {
          nodes: [
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
            topFile('reader.ts', 'modified'),
          ],
          edges: [],
        },
        symbols: [
          symbolsOf('web/file/reader.ts', [
            {
              name: 'Reader',
              kind: 'type',
              exported: { base: true, head: true },
              change: 'edited',
              signature,
            },
          ]),
        ],
      })}
    />,
  );
  await user.click(await screen.findByRole('button', { name: 'reader.ts: modified' }));
  await user.click(within(inspector()).getByRole('tab', { name: 'Symbols 1' }));
  return within(screen.getByRole('list', { name: 'Signature of type Reader' }))
    .getAllByRole('listitem')
    .map(line => line.textContent);
};

test('a changed signature reads as its opener, its members, each gained or lost one marked, and its closer', async () => {
  expect(
    await signatureLinesOf({
      base: 'interface Reader { name: string; holds(root: string): boolean; }',
      head: 'interface Reader { name: string; symbols?: Read; }',
    }),
  ).toEqual([
    'interface Reader {',
    '… 1 member as it wasname: string',
    '− holds(root: string): boolean',
    '+ symbols?: Read',
    '}',
  ]);
});

test('members as they were fold under a count, one run per gap, a lone one worded for one', async () => {
  const user = userEvent.setup();
  await signatureLinesOf({
    base: 'interface Reader { a: 1; b: 2; c: 3; d: 4; e: 5; }',
    head: 'interface Reader { a: 1; b: 2; x: 9; c: 3; e: 5; }',
  });
  const signature = within(screen.getByRole('list', { name: 'Signature of type Reader' }));
  const [two, one, last] = signature.getAllByRole('group');
  expect(two?.textContent).toBe('… 2 members as they werea: 1b: 2');
  expect(one?.textContent).toBe('… 1 member as it wasc: 3');
  expect(last?.textContent).toBe('… 1 member as it wase: 5');
  expect(two?.hasAttribute('open')).toBe(false);
  await user.click(signature.getByText('… 2 members as they were'));
  expect(two?.hasAttribute('open')).toBe(true);
});

test('a member of one name changed reads as both, base then head', async () => {
  expect(await signatureLinesOf({ base: '(a, b: 1)', head: '(a, b: 2)' })).toContain(
    '~ b: 1 → b: 2',
  );
});

test('a renamed symbol says what it was renamed from, probably when its body changed too', async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        range: 'abc123..def456',
        diff: {
          nodes: [
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
            topFile('refund.ts', 'modified'),
          ],
          edges: [],
        },
        symbols: [
          symbolsOf('web/file/refund.ts', [
            {
              name: 'settle',
              kind: 'function',
              exported: { base: false, head: false },
              change: 'renamed',
              renamedFrom: 'pay',
            },
            {
              name: 'void',
              scope: 'Refunds',
              kind: 'method',
              exported: { base: false, head: false },
              change: 'renamed',
              renamedFrom: 'Refunds.cancel',
              probably: true,
            },
          ]),
        ],
      })}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'refund.ts: modified' }));
  await user.click(within(inspector()).getByRole('tab', { name: 'Symbols 2' }));
  expect(screen.getByRole('listitem', { name: 'function settle: renamed' }).textContent).toBe(
    'function settle renamed from pay',
  );
  expect(screen.getByRole('listitem', { name: 'method Refunds.void: renamed' }).textContent).toBe(
    'method Refunds.void probably renamed from Refunds.cancel',
  );
});

test('a moved symbol names the file it moved to or from, and goes to that file', async () => {
  const user = userEvent.setup();
  const moved = {
    name: 'tax',
    kind: 'function' as const,
    exported: { base: false, head: false },
    change: 'moved' as const,
  };
  render(
    <ReviewPage
      review={pageWith({
        range: 'abc123..def456',
        diff: {
          nodes: [
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
            topFile('refund.ts', 'modified'),
            topFile('tax.ts', 'modified'),
          ],
          edges: [],
        },
        symbols: [
          symbolsOf('web/file/refund.ts', [{ ...moved, movedTo: 'web/file/tax.ts' }]),
          symbolsOf('web/file/tax.ts', [{ ...moved, movedFrom: 'web/file/refund.ts' }]),
        ],
      })}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'refund.ts: modified' }));
  await user.click(within(inspector()).getByRole('tab', { name: 'Symbols 1' }));
  const movedTo = screen.getByRole('listitem', { name: 'function tax: moved' });
  expect(movedTo.textContent).toBe('function tax moved to tax.ts');
  await user.click(within(movedTo).getByRole('button', { name: 'tax.ts' }));
  expect(within(inspector()).getByRole('heading', { level: 2 }).textContent).toBe('tax.ts');
  const movedFrom = screen.getByRole('listitem', { name: 'function tax: moved' });
  expect(movedFrom.textContent).toBe('function tax moved from refund.ts');
  await user.click(within(movedFrom).getByRole('button', { name: 'refund.ts' }));
  expect(within(inspector()).getByRole('heading', { level: 2 }).textContent).toBe('refund.ts');
});

test("a box's Symbols tab lists each file inside it with symbol changes, each with its own groups; a logic line opens its own file's patch on its row, or at its top when outside every hunk, until another part is picked", async () => {
  const user = userEvent.setup();
  const inBilling = (label: string) => ({
    ...topFile(label, 'modified'),
    parent: 'web/module/billing',
    path: `web/src/billing/${label}`,
  });
  const symbol = (name: string, change: SymbolStatement['change']): SymbolStatement => ({
    name,
    kind: 'function',
    exported: { base: false, head: false },
    change,
  });
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
            inBilling('refund.ts'),
            inBilling('tax.ts'),
            inBilling('total.ts'),
            topFile('outside.ts', 'modified'),
          ],
          edges: [],
        },
        symbols: [
          symbolsOf('web/file/refund.ts', [
            {
              ...symbol('refund', 'edited'),
              logic: [
                { change: 'added', kind: 'throw', depth: 0, head: 'throw new Late', line: 2 },
                { change: 'added', kind: 'return', depth: 1, head: 'return late', line: 40 },
              ],
            },
          ]),
          symbolsOf('web/file/tax.ts', [symbol('tax', 'added'), symbol('round', 'unchanged')]),
          symbolsOf('web/file/total.ts', [symbol('total', 'unchanged')]),
          symbolsOf('web/file/outside.ts', [symbol('outside', 'edited')]),
        ],
        patches: [
          {
            path: 'web/src/billing/refund.ts',
            patch: ['@@ -1,1 +1,2 @@', ' function refund() {', '+  throw new Late();'].join('\n'),
          },
          {
            path: 'web/src/billing/tax.ts',
            patch: ['@@ -1,1 +1,2 @@', ' function tax() {', '+  return 0;'].join('\n'),
          },
        ],
      })}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'billing: modified' }));
  await user.click(within(inspector()).getByRole('tab', { name: 'Symbols 2' }));
  const files = within(screen.getByRole('tabpanel', { name: 'Symbols' })).getAllByRole('region');
  expect(
    files.map(file => [
      file.getAttribute('aria-label'),
      within(file)
        .getAllByRole('list')
        .map(list => [
          list.getAttribute('aria-label'),
          within(list)
            .getAllByRole('listitem')
            .map(item => item.getAttribute('aria-label')),
        ]),
    ]),
  ).toEqual([
    [
      'refund.ts',
      [
        [
          'Edited',
          ['function refund: edited', 'added throw: throw new Late', 'added return: return late'],
        ],
        ['Logic of function refund', ['added throw: throw new Late', 'added return: return late']],
      ],
    ],
    [
      'tax.ts',
      [
        ['Added', ['function tax: added']],
        ['Unchanged', ['function round: unchanged']],
      ],
    ],
  ]);

  await user.click(
    within(screen.getByRole('tabpanel', { name: 'Symbols' })).getByRole('button', {
      name: /^added throw/,
    }),
  );
  const changes = within(screen.getByRole('tabpanel', { name: 'Diff' }));
  expect(
    changes
      .getAllByRole('group')
      .map(patch => [patch.getAttribute('aria-label'), patch.hasAttribute('open')]),
  ).toEqual([
    ['web/src/billing/refund.ts', true],
    ['web/src/billing/tax.ts', false],
  ]);
  expect(
    Array.from(document.querySelectorAll('[aria-current="true"]'), row => row.textContent),
  ).toEqual(['+  throw new Late();']);

  await user.click(within(inspector()).getByRole('tab', { name: 'Symbols 2' }));
  await user.click(
    within(screen.getByRole('tabpanel', { name: 'Symbols' })).getByRole('button', {
      name: /^added return/,
    }),
  );
  const scrolled = scrolledIntoView.mock.contexts.at(-1);
  expect(scrolled instanceof HTMLElement && scrolled.getAttribute('aria-label')).toBe(
    'web/src/billing/refund.ts',
  );
  expect(document.querySelectorAll('[aria-current="true"]')).toHaveLength(0);

  await user.click(within(inspector()).getByRole('tab', { name: 'Symbols 2' }));
  await user.click(
    within(screen.getByRole('tabpanel', { name: 'Symbols' })).getByRole('button', {
      name: /^added throw/,
    }),
  );
  await user.click(screen.getByRole('button', { name: 'outside.ts: modified' }));
  await user.click(screen.getByRole('button', { name: 'billing: modified' }));
  await user.click(within(inspector()).getByRole('tab', { name: 'Diff' }));
  expect(
    within(screen.getByRole('tabpanel', { name: 'Diff' }))
      .getAllByRole('group')
      .map(patch => patch.hasAttribute('open')),
  ).toEqual([false, false]);
  expect(document.querySelectorAll('[aria-current="true"]')).toHaveLength(0);
});

test("an edited function's logic lines show under it on the Symbols tab, each with its change, kind and text, a changed one base then head; a line that changed opens the Diff tab on its row, head side unless removed", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        range: 'abc123..def456',
        diff: {
          nodes: [
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
            topFile('refund.ts', 'modified'),
          ],
          edges: [],
        },
        symbols: [
          symbolsOf('web/file/refund.ts', [
            {
              name: 'refund',
              kind: 'function',
              exported: { base: false, head: false },
              change: 'edited',
              logic: [
                { change: 'removed', kind: 'guard', depth: 0, base: 'if (!paid) return', line: 2 },
                {
                  change: 'same',
                  kind: 'loop',
                  depth: 0,
                  head: 'for (const line of lines)',
                  line: 3,
                },
                {
                  change: 'changed',
                  kind: 'if',
                  depth: 1,
                  base: 'if (a > 0)',
                  head: 'if (a >= 0)',
                  line: 4,
                },
                { change: 'added', kind: 'throw', depth: 2, head: 'throw new Late', line: 5 },
              ],
            },
          ]),
        ],
        patches: [
          {
            path: 'web/src/refund.ts',
            patch: [
              'diff --git a/web/src/refund.ts b/web/src/refund.ts',
              '@@ -1,4 +1,5 @@',
              ' function refund(order, lines) {',
              '-  if (!paid) return;',
              '+  const late = true;',
              '   for (const line of lines) {',
              '-    if (a > 0) {',
              '+    if (a >= 0) {',
              '+      throw new Late();',
            ].join('\n'),
          },
        ],
      })}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'refund.ts: modified' }));
  await user.click(within(inspector()).getByRole('tab', { name: 'Symbols 1' }));
  const logic = within(screen.getByRole('tabpanel', { name: 'Symbols' })).getByRole('list', {
    name: 'Logic of function refund',
  });
  expect(
    within(logic)
      .getAllByRole('listitem')
      .map(item => item.getAttribute('aria-label')),
  ).toEqual([
    'removed guard: if (!paid) return',
    'same loop: for (const line of lines)',
    'changed if: if (a > 0) → if (a >= 0)',
    'added throw: throw new Late',
  ]);
  expect(
    within(logic)
      .getAllByRole('button')
      .map(button => button.getAttribute('aria-label')),
  ).toEqual([
    'removed guard: if (!paid) return',
    'changed if: if (a > 0) → if (a >= 0)',
    'added throw: throw new Late',
  ]);
  const landed = () => {
    const row = scrolledIntoView.mock.contexts.at(-1);
    return row instanceof HTMLElement ? [row.textContent, row.getAttribute('aria-current')] : [];
  };

  await user.click(within(logic).getByRole('button', { name: /^changed if/ }));
  expect(within(inspector()).getByRole('tab', { selected: true }).textContent).toBe('Diff');
  expect(landed()).toEqual(['+    if (a >= 0) {', 'true']);
  await user.click(within(inspector()).getByRole('tab', { name: 'Symbols 1' }));
  await user.click(
    within(screen.getByRole('tabpanel', { name: 'Symbols' })).getByRole('button', {
      name: /^removed guard/,
    }),
  );
  expect(landed()).toEqual(['-  if (!paid) return;', 'true']);
});

test('a moved logic line names the symbol it moved to, and opens the Diff tab on its base row', async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        range: 'abc123..def456',
        diff: {
          nodes: [
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
            topFile('refund.ts', 'modified'),
            topFile('retry.ts', 'modified'),
          ],
          edges: [],
        },
        symbols: [
          symbolsOf('web/file/refund.ts', [
            {
              name: 'refund',
              kind: 'function',
              exported: { base: false, head: false },
              change: 'edited',
              logic: [
                {
                  change: 'moved',
                  kind: 'guard',
                  depth: 0,
                  base: 'if (!paid) return',
                  line: 2,
                  movedTo: 'checked',
                },
                {
                  change: 'moved',
                  kind: 'catch',
                  depth: 0,
                  base: 'catch (error)',
                  line: 3,
                  movedTo: 'refund',
                  movedToNode: 'web/file/retry.ts',
                },
              ],
            },
          ]),
        ],
        patches: [
          {
            path: 'web/src/refund.ts',
            patch: [
              'diff --git a/web/src/refund.ts b/web/src/refund.ts',
              '@@ -1,2 +1,2 @@',
              ' function refund(order) {',
              '-  if (!paid) return;',
              '+  checked(order);',
            ].join('\n'),
          },
        ],
      })}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'refund.ts: modified' }));
  await user.click(within(inspector()).getByRole('tab', { name: 'Symbols 1' }));
  const panel = within(screen.getByRole('tabpanel', { name: 'Symbols' }));
  const line = panel.getByRole('button', {
    name: 'moved guard: if (!paid) return, moved to checked',
  });
  expect(line.textContent).toMatch(/moved to checked$/);
  expect(
    panel.getByRole('button', {
      name: 'moved catch: catch (error), moved to refund in retry.ts',
    }).textContent,
  ).toMatch(/moved to refund in retry\.ts$/);

  await user.click(line);
  const row = scrolledIntoView.mock.contexts.at(-1);
  expect(row instanceof HTMLElement ? row.textContent : undefined).toBe('-  if (!paid) return;');
});

test("a file whose symbols wouldn't parse shows the parse error on its Symbols tab, and in its box's", async () => {
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
            topFile('total.ts', 'modified'),
          ],
          edges: [],
        },
        symbols: [
          { node: 'web/file/refund.ts', stack: 'web', unreadable: 'Unexpected token (3:4)' },
          { node: 'web/file/total.ts', stack: 'web', unreadable: 'Missing semicolon (7:1)' },
        ],
      })}
    />,
  );
  const symbolsTab = () => screen.getByRole('tabpanel', { name: 'Symbols' });

  await user.click(await screen.findByRole('button', { name: 'billing: modified' }));
  await user.click(within(inspector()).getByRole('tab', { name: 'Symbols' }));
  expect(
    within(within(symbolsTab()).getByRole('region', { name: 'refund.ts' })).getByText(
      'Unexpected token (3:4)',
      { exact: false },
    ),
  ).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'total.ts: modified' }));
  expect(within(symbolsTab()).getByText('Missing semicolon (7:1)', { exact: false })).toBeTruthy();
});

test('a box read as a part keeps its reading number once it is expanded, and an expanded box that is none gets no number', async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        range: 'abc123..def456',
        diff: {
          nodes: [
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'modified' },
            webModule('utils', 'modified'),
            webFile('utils', 'x.ts'),
            webFile('utils', 'y.ts'),
            webModule('lib'),
            webFile('lib', 'z.ts'),
          ],
          edges: [],
        },
        readingOrder: { parts: ['web/module/utils'], cycles: [] },
      })}
    />,
  );
  await showEverything(user);
  const web = await screen.findByRole('group', { name: 'web' });
  await user.click(within(web).getByRole('button', { name: 'Expand utils' }));
  await user.click(within(web).getByRole('button', { name: 'Expand lib' }));

  const numbersIn = async (box: string) =>
    within(await within(web).findByRole('group', { name: box }))
      .queryAllByRole('img', { name: /^Reading order/ })
      .map(number => number.getAttribute('aria-label'));
  expect(await numbersIn('utils')).toEqual(['Reading order 1']);
  expect(await numbersIn('lib')).toEqual([]);
});

const symbolsTab = () => screen.getByRole('tabpanel', { name: 'Symbols' });

test("a served page's symbol row takes a comment, on its file and qualified name, held while the inspector goes elsewhere", async () => {
  const user = userEvent.setup();
  const sent = vi.fn(async () => {});
  render(
    <ReviewPage
      review={pageWith({
        range: review.range,
        diff: {
          nodes: [
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
            topFile('review-page.tsx', 'modified'),
          ],
          edges: [],
        },
        symbols: [
          symbolsOf('web/file/review-page.tsx', [
            {
              name: 'goTo',
              scope: 'ReviewPage',
              kind: 'method',
              exported: { base: false, head: false },
              change: 'edited',
            },
          ]),
        ],
      })}
      send={sent}
    />,
  );
  const symbolComment = () => within(symbolsTab()).getByRole('textbox', { name: 'Your comment' });
  const commentOn = () =>
    within(symbolsTab()).getByRole('button', { name: 'Comment on method ReviewPage.goTo' });

  await user.click(await screen.findByRole('button', { name: 'review-page.tsx: modified' }));
  await user.click(within(inspector()).getByRole('tab', { name: 'Symbols 1' }));
  await user.click(commentOn());
  await user.click(commentOn());
  expect(commentOn().getAttribute('aria-expanded')).toBe('false');
  expect(within(symbolsTab()).queryByRole('textbox', { name: 'Your comment' })).toBeNull();
  await user.click(commentOn());
  expect(commentOn().getAttribute('aria-expanded')).toBe('true');
  await user.click(within(symbolsTab()).getByRole('radio', { name: 'Change this' }));
  await user.type(symbolComment(), 'Split it.');
  await user.click(within(inspector()).getByRole('tab', { name: 'Note' }));
  await user.click(within(inspector()).getByRole('tab', { name: 'Symbols 1' }));
  expect(symbolComment()).toHaveProperty('value', 'Split it.');
  await openReview(user);
  await user.click(screen.getByRole('button', { name: 'Send to Claude' }));

  expect(sent).toHaveBeenCalledExactlyOnceWith(
    sentReview({
      verdict: 'request-changes',
      comments: [
        {
          anchor: { kind: 'symbol', id: 'web/file/review-page.tsx#ReviewPage.goTo' },
          kind: 'change',
          text: 'Split it.',
        },
      ],
    }),
  );
});

test("a served page's logic line takes a comment on its decision, the same id as the line's logic:removed finding, quoting the line", async () => {
  const user = userEvent.setup();
  const sent = vi.fn(async () => {});
  const file = topFile('review-page.tsx', 'modified');
  const symbols = [
    symbolsOf(file.id, [
      {
        name: 'goTo',
        scope: 'ReviewPage',
        kind: 'method',
        exported: { base: false, head: false },
        change: 'edited',
        logic: [
          { change: 'added', kind: 'guard', depth: 0, head: 'if (!open) return', line: 3 },
          { change: 'removed', kind: 'guard', depth: 0, base: 'if (!open) return', line: 9 },
          { change: 'same', kind: 'if', depth: 0, head: 'if (ready)', line: 12 },
          { change: 'changed', kind: 'if', depth: 0, base: 'if (a)', head: 'if (b)', line: 15 },
        ],
      },
    ]),
  ];
  const lost = symbolFindings({ files: symbols, nodes: [file] }).find(finding =>
    finding.id.startsWith('logic:removed:'),
  );
  render(
    <ReviewPage
      review={pageWith({
        range: review.range,
        diff: {
          nodes: [{ id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' }, file],
          edges: [],
        },
        symbols,
      })}
      send={sent}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'review-page.tsx: modified' }));
  await user.click(within(inspector()).getByRole('tab', { name: 'Symbols 1' }));
  expect(
    within(symbolsTab()).getByRole('button', { name: 'Comment on same if: if (ready)' }),
  ).toBeTruthy();
  await user.click(
    within(symbolsTab()).getByRole('button', {
      name: 'Comment on removed guard: if (!open) return',
    }),
  );
  await write(
    user,
    within(symbolsTab()).getByRole('textbox', { name: 'Your comment' }),
    'Why did it move?',
  );
  await user.click(
    within(symbolsTab()).getByRole('button', { name: 'Comment on changed if: if (a) → if (b)' }),
  );
  await write(
    user,
    within(
      within(symbolsTab()).getByRole('listitem', { name: 'changed if: if (a) → if (b)' }),
    ).getByRole('textbox', { name: 'Your comment' }),
    'Why b?',
  );
  await openReview(user);
  await user.click(screen.getByRole('button', { name: 'Send to Claude' }));

  expect(sent).toHaveBeenCalledExactlyOnceWith(
    sentReview({
      verdict: 'comment',
      comments: [
        {
          anchor: {
            kind: 'decision',
            id: lost?.id.slice('logic:removed:'.length) ?? '',
            text: 'if (!open) return',
          },
          kind: 'question',
          text: 'Why did it move?',
        },
        {
          anchor: {
            kind: 'decision',
            id: 'web/file/review-page.tsx#ReviewPage.goTo#if (b)',
            text: 'if (b)',
          },
          kind: 'question',
          text: 'Why b?',
        },
      ],
    }),
  );
  expect(lost?.id).toBe(
    'logic:removed:web/file/review-page.tsx#ReviewPage.goTo#if (!open) return#2',
  );
});

test("a logic line of the later of two same-named symbols comments on its own decision, not its twin's", async () => {
  const user = userEvent.setup();
  const sent = vi.fn(async () => {});
  const accessor = {
    name: 'x',
    scope: 'C',
    kind: 'method' as const,
    exported: { base: false, head: false },
    change: 'edited' as const,
    logic: [
      {
        change: 'removed' as const,
        kind: 'guard' as const,
        depth: 0,
        base: 'if (a) return',
        line: 3,
      },
    ],
  };
  render(
    <ReviewPage
      review={pageWith({
        range: review.range,
        diff: {
          nodes: [
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
            topFile('c.ts', 'modified'),
          ],
          edges: [],
        },
        symbols: [symbolsOf('web/file/c.ts', [accessor, accessor])],
      })}
      send={sent}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'c.ts: modified' }));
  await user.click(within(inspector()).getByRole('tab', { name: /^Symbols/ }));
  const [, later] = within(symbolsTab()).getAllByRole('button', {
    name: 'Comment on removed guard: if (a) return',
  });
  await user.click(later ?? symbolsTab());
  await write(user, within(symbolsTab()).getByRole('textbox', { name: 'Your comment' }), 'Why?');
  await openReview(user);
  await user.click(screen.getByRole('button', { name: 'Send to Claude' }));

  expect(sent).toHaveBeenCalledExactlyOnceWith(
    sentReview({
      comments: [
        {
          anchor: {
            kind: 'decision',
            id: 'web/file/c.ts#C.x#2#if (a) return',
            text: 'if (a) return',
          },
          kind: 'question',
          text: 'Why?',
        },
      ],
    }),
  );
});

test('a draft in the open tray goes to the tab it was written on, though the inspector was closed or on another tab', async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        range: review.range,
        diff: {
          nodes: [
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
            topFile('review-page.tsx', 'modified'),
          ],
          edges: [],
        },
        symbols: [
          symbolsOf('web/file/review-page.tsx', [
            {
              name: 'goTo',
              scope: 'ReviewPage',
              kind: 'method',
              exported: { base: false, head: false },
              change: 'edited',
              logic: [{ change: 'same', kind: 'if', depth: 0, head: 'if (ready)', line: 12 }],
            },
          ]),
        ],
      })}
      send={vi.fn(async () => {})}
    />,
  );
  const panelOf = (name: string) => screen.getByRole('tabpanel', { name });
  const fieldIn = (name: string) =>
    within(panelOf(name)).getByRole('textbox', { name: 'Your comment' });

  await user.click(await screen.findByRole('button', { name: 'review-page.tsx: modified' }));
  await write(user, fieldIn('Note'), 'On the file.');
  await user.click(within(inspector()).getByRole('tab', { name: 'Symbols 1' }));
  await user.click(
    within(symbolsTab()).getByRole('button', { name: 'Comment on method ReviewPage.goTo' }),
  );
  await write(user, fieldIn('Symbols'), 'On the method.');
  await user.click(
    within(symbolsTab()).getByRole('button', { name: 'Comment on same if: if (ready)' }),
  );
  await write(
    user,
    within(within(symbolsTab()).getByRole('listitem', { name: 'same if: if (ready)' })).getByRole(
      'textbox',
      { name: 'Your comment' },
    ),
    'On the line.',
  );
  await user.click(screen.getByRole('button', { name: 'Close inspector' }));
  await openReview(user);

  await user.click(screen.getByRole('button', { name: 'ReviewPage.goTo in review-page.tsx' }));
  expect(
    within(
      within(symbolsTab()).getByRole('listitem', { name: 'method ReviewPage.goTo: edited' }),
    ).getAllByRole('textbox', { name: 'Your comment' })[0],
  ).toHaveProperty('value', 'On the method.');
  await user.click(
    within(screen.getByRole('list', { name: 'Drafts' })).getByRole('button', {
      name: 'review-page.tsx',
    }),
  );
  expect(fieldIn('Note')).toHaveProperty('value', 'On the file.');
  await user.click(screen.getByRole('button', { name: 'if (ready)' }));
  expect(
    within(within(symbolsTab()).getByRole('listitem', { name: 'same if: if (ready)' })).getByRole(
      'textbox',
      { name: 'Your comment' },
    ),
  ).toHaveProperty('value', 'On the line.');
});

test("same-named symbols in one file take a comment each, counted through the file's symbols whatever group shows them, and a draft on a later one still opens the unchanged", async () => {
  const user = userEvent.setup();
  const sent = vi.fn(async () => {});
  const named = (kind: SymbolStatement['kind'], change: SymbolStatement['change']) => ({
    name: 'F',
    kind,
    exported: { base: false, head: false },
    change,
  });
  render(
    <ReviewPage
      review={pageWith({
        range: review.range,
        diff: {
          nodes: [
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
            topFile('tax.ts', 'modified'),
          ],
          edges: [],
        },
        symbols: [
          symbolsOf('web/file/tax.ts', [
            named('type', 'added'),
            named('function', 'edited'),
            named('function', 'unchanged'),
          ]),
        ],
      })}
      send={sent}
    />,
  );
  const commentIn = async (group: string, name: string, text: string) => {
    const row = within(within(symbolsTab()).getByRole('list', { name: group })).getByRole(
      'listitem',
    );
    await user.click(within(row).getByRole('button', { name: `Comment on ${name}` }));
    await write(user, within(row).getByRole('textbox', { name: 'Your comment' }), text);
  };

  await user.click(await screen.findByRole('button', { name: 'tax.ts: modified' }));
  await user.click(within(inspector()).getByRole('tab', { name: /^Symbols/ }));
  await commentIn('Edited', 'function F', 'On the edited one.');
  await commentIn('Added', 'type F', 'On the type.');
  await user.click(within(symbolsTab()).getByText('1 unchanged'));
  await commentIn('Unchanged', 'function F', 'On the unchanged one.');
  await user.click(within(inspector()).getByRole('tab', { name: 'Note' }));
  await user.click(within(inspector()).getByRole('tab', { name: /^Symbols/ }));
  expect(within(symbolsTab()).getByRole('group').hasAttribute('open')).toBe(true);
  await openReview(user);
  await user.click(screen.getByRole('button', { name: 'Send to Claude' }));

  const on = (id: string, text: string) => ({
    anchor: { kind: 'symbol' as const, id },
    kind: 'question' as const,
    text,
  });
  expect(sent).toHaveBeenCalledExactlyOnceWith(
    sentReview({
      comments: [
        on('web/file/tax.ts#F#2', 'On the edited one.'),
        on('web/file/tax.ts#F', 'On the type.'),
        on('web/file/tax.ts#F#3', 'On the unchanged one.'),
      ],
    }),
  );
});

test('the inspector goes back to Note when it closes or Structure is left, and holds its tab between parts', async () => {
  const user = userEvent.setup();
  const symbol = {
    name: 'tax',
    kind: 'function' as const,
    exported: { base: false, head: false },
    change: 'edited' as const,
  };
  render(
    <ReviewPage
      review={pageWith({
        range: review.range,
        diff: {
          nodes: [
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
            topFile('tax.ts', 'modified'),
            topFile('vat.ts', 'modified'),
          ],
          edges: [],
        },
        symbols: [symbolsOf('web/file/tax.ts', [symbol]), symbolsOf('web/file/vat.ts', [symbol])],
      })}
    />,
  );
  const pickSymbols = () => user.click(within(inspector()).getByRole('tab', { name: /^Symbols/ }));
  const onTab = () => within(inspector()).getByRole('tab', { selected: true }).textContent;

  await user.click(await screen.findByRole('button', { name: 'tax.ts: modified' }));
  await pickSymbols();
  await user.click(screen.getByRole('button', { name: 'vat.ts: modified' }));
  expect(onTab()).toMatch(/^Symbols/);

  await user.click(within(inspector()).getByRole('button', { name: 'Close inspector' }));
  await user.click(screen.getByRole('button', { name: 'tax.ts: modified' }));
  expect(onTab()).toBe('Note');

  await pickSymbols();
  await user.click(screen.getByRole('link', { name: /^Tests/ }));
  await screen.findByRole('group', { name: 'Tests shown' });
  await user.click(screen.getByRole('link', { name: /^Structure/ }));
  await screen.findByRole('button', { name: 'tax.ts: modified' });
  expect(onTab()).toBe('Note');
});

test('the inspector holds its tab through an edge selected between two parts', async () => {
  const user = userEvent.setup();
  const symbol = {
    name: 'tax',
    kind: 'function' as const,
    exported: { base: false, head: false },
    change: 'edited' as const,
  };
  render(
    <ReviewPage
      review={pageWith({
        range: review.range,
        diff: {
          nodes: [
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
            topFile('tax.ts', 'modified'),
            topFile('vat.ts', 'modified'),
          ],
          edges: [
            {
              from: 'web/file/tax.ts',
              to: 'web/file/vat.ts',
              state: 'added',
            },
          ],
        },
        symbols: [symbolsOf('web/file/tax.ts', [symbol]), symbolsOf('web/file/vat.ts', [symbol])],
      })}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'tax.ts: modified' }));
  await user.click(within(inspector()).getByRole('tab', { name: /^Symbols/ }));
  await user.click(screen.getByRole('button', { name: 'tax.ts → vat.ts: added' }));
  await user.click(screen.getByRole('button', { name: 'vat.ts: modified' }));

  expect(within(inspector()).getByRole('tab', { selected: true }).textContent).toMatch(/^Symbols/);
});

test('going to a finding answer in the open tray opens Note, where the answer is, whatever tab was up', async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        range: review.range,
        diff: {
          nodes: [
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
            topFile('tax.ts', 'modified'),
          ],
          edges: [],
        },
        findings: [findingOn('web/file/tax.ts')],
        symbols: [
          symbolsOf('web/file/tax.ts', [
            {
              name: 'tax',
              kind: 'function',
              exported: { base: false, head: false },
              change: 'edited',
            },
          ]),
        ],
      })}
      send={async () => {}}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'tax.ts: modified' }));
  await user.click(within(noteTab()).getByRole('button', { name: 'Fix this' }));
  await user.click(within(inspector()).getByRole('tab', { name: /^Symbols/ }));
  await openReview(user);
  await user.click(screen.getByRole('button', { name: 'lines 900, over 800' }));

  expect(within(inspector()).getByRole('tab', { selected: true }).textContent).toBe('Note');
});

const pageWithAnUnchangedSymbol = () =>
  pageWith({
    range: review.range,
    diff: {
      nodes: [
        { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
        topFile('tax.ts', 'modified'),
      ],
      edges: [],
    },
    symbols: [
      symbolsOf('web/file/tax.ts', [
        {
          name: 'tax',
          kind: 'function',
          exported: { base: false, head: false },
          change: 'edited',
          logic: [{ change: 'added', kind: 'guard', depth: 0, head: 'if (!rate) return', line: 2 }],
        },
        {
          name: 'round',
          kind: 'function',
          exported: { base: false, head: false },
          change: 'unchanged',
        },
      ]),
    ],
  });

const unchangedSymbols = () => within(symbolsTab()).getByRole('group');

const leaveSymbolsAndComeBack = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(within(inspector()).getByRole('tab', { name: 'Note' }));
  await user.click(within(inspector()).getByRole('tab', { name: /^Symbols/ }));
};

const draftOnTheUnchangedSymbol = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(within(symbolsTab()).getByText('1 unchanged'));
  await user.click(within(symbolsTab()).getByRole('button', { name: 'Comment on function round' }));
  await write(
    user,
    within(symbolsTab()).getByRole('textbox', { name: 'Your comment' }),
    'Why not?',
  );
};

test('the unchanged symbols open by themselves when one holds a draft', async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={pageWithAnUnchangedSymbol()} send={vi.fn(async () => {})} />);

  await user.click(await screen.findByRole('button', { name: 'tax.ts: modified' }));
  await user.click(within(inspector()).getByRole('tab', { name: /^Symbols/ }));
  expect(unchangedSymbols().hasAttribute('open')).toBe(false);
  await draftOnTheUnchangedSymbol(user);
  await leaveSymbolsAndComeBack(user);

  expect(unchangedSymbols().hasAttribute('open')).toBe(true);
});

test('a page that is not served has no Comment toggle on a symbol or a logic line', async () => {
  const user = userEvent.setup();
  const page = pageWithAnUnchangedSymbol();
  const { rerender } = render(<ReviewPage review={page} send={vi.fn(async () => {})} />);
  const toggles = () =>
    within(symbolsTab())
      .queryAllByRole('button', { name: /^Comment on/ })
      .map(toggle => toggle.getAttribute('aria-label'));

  await user.click(await screen.findByRole('button', { name: 'tax.ts: modified' }));
  await user.click(within(inspector()).getByRole('tab', { name: /^Symbols/ }));
  expect(toggles()).toContain('Comment on function tax');
  expect(toggles()).toContain('Comment on added guard: if (!rate) return');

  rerender(<ReviewPage review={page} />);
  expect(toggles()).toStrictEqual([]);
});

const testsTab = () => screen.getByRole('tabpanel', { name: 'Tests' });

const pageWithSameNamedTests = () =>
  pageWith({
    range: review.range,
    diff: {
      nodes: [
        { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
        topFile('total.ts', 'modified'),
      ],
      edges: [],
    },
    tests: [
      {
        path: 'total.test.ts',
        stack: 'web',
        statements: [
          {
            kind: 'heading',
            name: 'Cart',
            children: [{ kind: 'test', name: 'adds tax', change: 'added' }],
          },
          {
            kind: 'heading',
            name: 'Till',
            children: [
              {
                kind: 'heading',
                name: 'at noon',
                children: [{ kind: 'test', name: 'adds tax', change: 'edited' }],
              },
            ],
          },
          { kind: 'test', name: 'drops totals', change: 'removed' },
        ],
      },
    ],
  });

test("a served page's test row in the inspector takes a comment, a removed test too, its id the test's file and headings, so tests of one name keep apart; a page not served has no toggle", async () => {
  const user = userEvent.setup();
  const sent = vi.fn(async () => {});
  const page = pageWithSameNamedTests();
  const { rerender } = render(<ReviewPage review={page} send={sent} />);
  const commentOn = async (name: string, rowName: string, text: string) => {
    const row = within(within(testsTab()).getByRole('listitem', { name: rowName }));
    await user.click(row.getByRole('button', { name: `Comment on ${name}` }));
    await write(user, row.getByRole('textbox', { name: 'Your comment' }), text);
  };

  await user.click(await screen.findByRole('button', { name: 'total.ts: modified' }));
  await user.click(within(inspector()).getByRole('tab', { name: 'Tests 3' }));
  await commentOn('Cart › adds tax', 'adds tax: added', 'On the cart.');
  await commentOn('Till › at noon › adds tax', 'adds tax: edited', 'On the till.');
  await commentOn('drops totals', 'drops totals: removed', 'Why gone?');
  await openReview(user);
  await user.click(screen.getByRole('button', { name: 'Send to Claude' }));

  expect(sent).toHaveBeenCalledExactlyOnceWith(
    sentReview({
      verdict: 'comment',
      comments: [
        {
          anchor: { kind: 'test', id: 'total.test.ts#Cart › adds tax' },
          kind: 'question',
          text: 'On the cart.',
        },
        {
          anchor: { kind: 'test', id: 'total.test.ts#Till › at noon › adds tax' },
          kind: 'question',
          text: 'On the till.',
        },
        {
          anchor: { kind: 'test', id: 'total.test.ts#drops totals' },
          kind: 'question',
          text: 'Why gone?',
        },
      ],
    }),
  );

  rerender(<ReviewPage review={page} />);
  expect(within(testsTab()).queryAllByRole('button', { name: /^Comment on/ })).toStrictEqual([]);
});

test("a served page's Tests screen takes a comment on a test row, one draft with the inspector's Tests tab; a page not served has no toggle", async () => {
  const user = userEvent.setup();
  const page = pageWithSameNamedTests();
  const { rerender } = render(<ReviewPage review={page} send={vi.fn(async () => {})} />);
  const row = (place: HTMLElement, rowName: string) =>
    within(within(place).getByRole('listitem', { name: rowName }));
  const testChanges = () => screen.getByRole('region', { name: 'Test changes' });

  await user.click(await screen.findByRole('button', { name: 'total.ts: modified' }));
  await user.click(within(inspector()).getByRole('tab', { name: 'Tests 3' }));
  await user.click(
    row(testsTab(), 'adds tax: added').getByRole('button', { name: 'Comment on Cart › adds tax' }),
  );
  await write(
    user,
    row(testsTab(), 'adds tax: added').getByRole('textbox', { name: 'Your comment' }),
    'From the inspector.',
  );

  await user.click(screen.getByRole('link', { name: 'Tests 3' }));
  expect(
    row(testChanges(), 'adds tax: added').getByRole('textbox', { name: 'Your comment' }),
  ).toHaveProperty('value', 'From the inspector.');
  await user.click(
    row(testChanges(), 'drops totals: removed').getByRole('button', {
      name: 'Comment on drops totals',
    }),
  );
  await write(
    user,
    row(testChanges(), 'drops totals: removed').getByRole('textbox', { name: 'Your comment' }),
    'From the screen.',
  );

  await user.click(screen.getByRole('link', { name: 'Structure' }));
  await user.click(within(inspector()).getByRole('tab', { name: 'Tests 3' }));
  expect(
    row(testsTab(), 'drops totals: removed').getByRole('textbox', { name: 'Your comment' }),
  ).toHaveProperty('value', 'From the screen.');

  await user.click(screen.getByRole('link', { name: 'Tests 3' }));
  rerender(<ReviewPage review={page} />);
  expect(within(testChanges()).queryAllByRole('button', { name: /^Comment on/ })).toStrictEqual([]);
});

test('two tests of one name under one heading keep a draft each, in the inspector and on the Tests screen, and the review sends each on its own id', async () => {
  const user = userEvent.setup();
  atHash('#structure');
  const sent = vi.fn(async () => {});
  const added = { kind: 'test' as const, name: 'adds tax', change: 'added' as const };
  render(
    <ReviewPage
      review={pageWith({
        range: review.range,
        diff: {
          nodes: [
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
            topFile('total.ts', 'modified'),
          ],
          edges: [],
        },
        tests: [
          {
            path: 'total.test.ts',
            stack: 'web',
            statements: [{ kind: 'heading', name: 'Cart', children: [added, added] }],
          },
        ],
      })}
      send={sent}
    />,
  );
  const twin = (place: HTMLElement, index: number) => {
    const row = within(place).getAllByRole('listitem', { name: 'adds tax: added' })[index];
    if (row === undefined) throw new Error(`no twin ${index}`);
    return within(row);
  };
  const field = (place: HTMLElement, index: number) =>
    twin(place, index).getByRole('textbox', { name: 'Your comment' });

  await user.click(await screen.findByRole('button', { name: 'total.ts: modified' }));
  await user.click(within(inspector()).getByRole('tab', { name: 'Tests 2' }));
  await user.click(twin(testsTab(), 0).getByRole('button', { name: 'Comment on Cart › adds tax' }));
  await write(user, field(testsTab(), 0), 'The first.');
  await user.click(
    twin(testsTab(), 1).getByRole('button', { name: 'Comment on Cart › adds tax#2' }),
  );
  expect(field(testsTab(), 1)).toHaveProperty('value', '');

  await user.click(screen.getByRole('link', { name: 'Tests 2' }));
  const testChanges = screen.getByRole('region', { name: 'Test changes' });
  expect(field(testChanges, 0)).toHaveProperty('value', 'The first.');
  await user.click(
    twin(testChanges, 1).getByRole('button', { name: 'Comment on Cart › adds tax#2' }),
  );
  expect(field(testChanges, 1)).toHaveProperty('value', '');
  await write(user, field(testChanges, 1), 'The second.');
  expect(field(testChanges, 0)).toHaveProperty('value', 'The first.');

  await openReview(user);
  const drafts = within(screen.getByRole('list', { name: 'Drafts' }));
  expect(drafts.getByRole('button', { name: 'adds tax' })).toBeTruthy();
  expect(drafts.getByRole('button', { name: 'adds tax#2' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Send to Claude' }));

  expect(sent).toHaveBeenCalledExactlyOnceWith(
    sentReview({
      verdict: 'comment',
      comments: [
        {
          anchor: { kind: 'test', id: 'total.test.ts#Cart › adds tax' },
          kind: 'question',
          text: 'The first.',
        },
        {
          anchor: { kind: 'test', id: 'total.test.ts#Cart › adds tax#2' },
          kind: 'question',
          text: 'The second.',
        },
      ],
    }),
  );
});

test("a test's draft in the tray opens the Tests tab of the file it's named after, though no box holds it, showing the draft", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        range: review.range,
        diff: {
          nodes: [
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
            topFile('total.ts', 'modified'),
          ],
          edges: [],
        },
        tests: [
          {
            path: 'test/total.test.ts',
            stack: 'web',
            statements: [{ kind: 'test', name: 'adds tax', change: 'added' }],
          },
        ],
      })}
      send={vi.fn(async () => {})}
    />,
  );
  const rowField = () =>
    within(within(testsTab()).getByRole('listitem', { name: 'adds tax: added' })).getByRole(
      'textbox',
      { name: 'Your comment' },
    );

  await user.click(await screen.findByRole('button', { name: 'total.ts: modified' }));
  await user.click(within(inspector()).getByRole('tab', { name: 'Tests 1' }));
  await user.click(within(testsTab()).getByRole('button', { name: 'Comment on adds tax' }));
  await write(user, rowField(), 'Which rate?');
  await user.click(screen.getByRole('button', { name: 'Close inspector' }));
  await openReview(user);

  await user.click(
    within(screen.getByRole('list', { name: 'Drafts' })).getByRole('button', { name: 'adds tax' }),
  );
  expect(rowField()).toHaveProperty('value', 'Which rate?');
});

const pageWithPatch = (...hunkLines: ReadonlyArray<string>) =>
  pageWith({
    range: review.range,
    diff: {
      nodes: [
        { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
        topFile('x.ts', 'modified'),
      ],
      edges: [],
    },
    patches: [
      {
        path: 'web/src/x.ts',
        patch: ['--- a/web/src/x.ts', '+++ b/web/src/x.ts', ...hunkLines].join('\n'),
      },
    ],
  });

const diffTab = () => screen.getByRole('tabpanel', { name: 'Diff' });

test("a served page's diff line takes a comment on its side and number, quoting it; a hunk's header takes none, nor does any line on a page not served", async () => {
  const user = userEvent.setup();
  const sent = vi.fn(async () => {});
  const page = pageWithPatch(
    '@@ -12,2 +12,2 @@',
    ' const y = 0;',
    '-const x = 1;',
    '+const x = 2;',
  );
  const { rerender } = render(<ReviewPage review={page} send={sent} />);
  const toggles = () =>
    within(diffTab())
      .queryAllByRole('button', { name: /^Comment on/ })
      .map(toggle => toggle.getAttribute('aria-label'));

  await user.click(await screen.findByRole('button', { name: 'x.ts: modified' }));
  await user.click(within(inspector()).getByRole('tab', { name: 'Diff' }));
  expect(toggles()).toStrictEqual([
    'Comment on x.ts:12 "const y = 0;"',
    'Comment on x.ts:13 "const x = 1;"',
    'Comment on x.ts:13 "const x = 2;"',
  ]);

  await user.click(
    within(diffTab()).getByRole('button', { name: 'Comment on x.ts:13 "const x = 1;"' }),
  );
  await write(user, within(diffTab()).getByRole('textbox', { name: 'Your comment' }), 'Why 1?');
  await openReview(user);
  await user.click(screen.getByRole('button', { name: 'Send to Claude' }));

  expect(sent).toHaveBeenCalledExactlyOnceWith(
    sentReview({
      verdict: 'comment',
      comments: [
        {
          anchor: { kind: 'line', id: 'web/src/x.ts@base:13', text: 'const x = 1;' },
          kind: 'question',
          text: 'Why 1?',
        },
      ],
    }),
  );

  rerender(<ReviewPage review={page} />);
  expect(toggles()).toStrictEqual([]);
});

test("the tray goes to a diff line's draft on the Diff tab, landing on its row on its side, each time", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWithPatch('@@ -1 +1 @@', '-const x = 1;', '+const x = 2;')}
      send={vi.fn(async () => {})}
    />,
  );
  const name = 'x.ts:1 "const x = 1;"';
  const goToDraft = () =>
    user.click(within(screen.getByRole('list', { name: 'Drafts' })).getByRole('button', { name }));

  await user.click(await screen.findByRole('button', { name: 'x.ts: modified' }));
  await user.click(within(inspector()).getByRole('tab', { name: 'Diff' }));
  await user.click(within(diffTab()).getByRole('button', { name: `Comment on ${name}` }));
  await write(user, within(diffTab()).getByRole('textbox', { name: 'Your comment' }), 'Why 1?');
  await user.click(screen.getByRole('button', { name: 'Close inspector' }));
  await openReview(user);

  await goToDraft();
  const row = within(diffTab()).getByRole('deletion', { current: true });
  expect(within(row).getByRole('textbox', { name: 'Your comment' })).toHaveProperty(
    'value',
    'Why 1?',
  );
  expect(scrolledIntoView.mock.contexts).toContain(row);

  scrolledIntoView.mockClear();
  await goToDraft();
  expect(scrolledIntoView.mock.contexts).toContain(row);

  const patch = within(diffTab()).getByRole('group', { name: 'web/src/x.ts' });
  await user.click(within(patch).getByText('web/src/x.ts'));
  expect(patch.hasAttribute('open')).toBe(false);
  const shownWhenScrolled = vi.fn();
  scrolledIntoView.mockImplementationOnce(() => shownWhenScrolled(patch.hasAttribute('open')));
  await goToDraft();
  expect(shownWhenScrolled.mock.calls).toStrictEqual([[true]]);
});

const patchOf = (path: string, ...hunkLines: ReadonlyArray<string>) => ({
  path,
  patch: [`--- a/${path}`, `+++ b/${path}`, ...hunkLines].join('\n'),
});

const pageWithFilesDrawnOnlyAsABox = () =>
  pageWith({
    range: review.range,
    diff: {
      nodes: [
        { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
        webModule('billing', 'modified'),
      ],
      edges: [],
    },
    patches: [
      patchOf('web/src/billing/refund.ts', '@@ -8 +8 @@', '-const late = 1;', '+const late = 2;'),
      patchOf('web/src/billing/tax.ts', '@@ -3 +3 @@', '-const rate = 1;', '+const rate = 2;'),
    ],
  });

test("the tray going to a diff line's draft in a file drawn only as its box opens that file's patch, and only that one", async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={pageWithFilesDrawnOnlyAsABox()} send={vi.fn(async () => {})} />);
  const name = 'web/src/billing/refund.ts:8 "const late = 2;"';
  const patchesOpen = () =>
    within(diffTab())
      .getAllByRole('group')
      .map(patch => [patch.getAttribute('aria-label'), patch.hasAttribute('open')]);

  await user.click(await screen.findByRole('button', { name: 'billing: modified' }));
  await user.click(within(inspector()).getByRole('tab', { name: 'Diff' }));
  expect(patchesOpen()).toStrictEqual([
    ['web/src/billing/refund.ts', false],
    ['web/src/billing/tax.ts', false],
  ]);
  await user.click(within(diffTab()).getByText('web/src/billing/refund.ts'));
  await user.click(within(diffTab()).getByRole('button', { name: `Comment on ${name}` }));
  await write(user, within(diffTab()).getByRole('textbox', { name: 'Your comment' }), 'Why 2?');
  await user.click(screen.getByRole('button', { name: 'Close inspector' }));
  await openReview(user);

  await user.click(
    within(screen.getByRole('list', { name: 'Drafts' })).getByRole('button', { name }),
  );
  expect(patchesOpen()).toStrictEqual([
    ['web/src/billing/refund.ts', true],
    ['web/src/billing/tax.ts', false],
  ]);
});

const pageWithUndrawnFile = () =>
  pageWith({
    ...review,
    undrawn: [
      { path: 'README.md', patch: '--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-old\n+new' },
    ],
    findings: [
      {
        id: 'structure:undrawn',
        check: 'structure:undrawn',
        dimension: 'structure',
        level: 'info',
        title: '1 changed file outside the graph',
        detail: 'README.md',
      },
    ],
  });

const openUndrawnFiles = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole('button', { name: 'Show 1 finding' }));
  await user.click(
    within(screen.getByRole('complementary', { name: 'Findings' })).getByRole('button', {
      name: 'README.md: 1 changed file outside the graph',
    }),
  );
};

const pageWithLockfile = (place: 'undrawn' | 'patches', path: string) =>
  pageWith({
    ...review,
    [place]: [{ path, patch: `--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+new` }],
    findings: [
      {
        id: `dependencies:${path}:zod`,
        check: 'dependencies:direct',
        dimension: 'dependencies',
        level: 'look',
        file: path,
        title: 'zod 3.25.0 → 4.6.7',
        detail: path,
      },
      {
        id: `dependencies:not-read:${path}`,
        check: 'dependencies:not-read',
        dimension: 'dependencies',
        level: 'look',
        file: path,
        title: `${path} not read: Yarn 2+ format`,
      },
    ],
  });

test("a dependencies finding opens its lockfile's patch among the files outside the graph, at its top, and closing them hands the keyboard focus back", async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={pageWithLockfile('undrawn', 'pnpm-lock.yaml')} />);

  await user.click(await screen.findByRole('button', { name: 'Show 2 findings' }));
  const finding = () =>
    within(screen.getByRole('complementary', { name: 'Findings' })).getByRole('button', {
      name: 'pnpm-lock.yaml: zod 3.25.0 → 4.6.7',
    });
  await user.click(finding());

  expect(within(inspector()).getByRole('heading', { level: 2 }).textContent).toBe(
    'Changed files outside the graph',
  );
  const patch = within(inspector()).getByRole('group', { name: 'pnpm-lock.yaml' });
  expect(patch.hasAttribute('open')).toBe(true);
  expect(scrolledIntoView.mock.contexts).toContain(patch);

  await user.click(within(inspector()).getByRole('button', { name: 'Close inspector' }));
  expect(document.activeElement).toBe(finding());

  await user.click(
    within(screen.getByRole('complementary', { name: 'Findings' })).getByRole('button', {
      name: 'pnpm-lock.yaml not read: Yarn 2+ format',
    }),
  );
  expect(within(inspector()).getByRole('group', { name: 'pnpm-lock.yaml' })).toBeDefined();
});

test("a dependencies finding opens its lockfile's patch on the Diff tab of the node holding it, at its top", async () => {
  const user = userEvent.setup();
  const path = 'crates/application/Cargo.lock';
  render(<ReviewPage review={pageWithLockfile('patches', path)} />);

  await user.click(await screen.findByRole('button', { name: 'Show 2 findings' }));
  await user.click(
    within(screen.getByRole('complementary', { name: 'Findings' })).getByRole('button', {
      name: `${path}: zod 3.25.0 → 4.6.7`,
    }),
  );

  expect(within(inspector()).getByRole('heading', { level: 2 }).textContent).toBe('application');
  expect(within(inspector()).getByRole('tab', { name: 'Diff' }).getAttribute('aria-selected')).toBe(
    'true',
  );
  const patch = within(inspector()).getByRole('group', { name: path });
  expect(patch.hasAttribute('open')).toBe(true);
  expect(scrolledIntoView.mock.contexts).toContain(patch);
});

test("an answer to a dependencies finding goes from the tray to its lockfile's patch, from any screen", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWithLockfile('undrawn', 'pnpm-lock.yaml')}
      send={vi.fn(async () => {})}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'Show 2 findings' }));
  const rail = screen.getByRole('complementary', { name: 'Findings' });
  const finding = within(rail).getByText('zod 3.25.0 → 4.6.7').closest('li') ?? rail;
  await user.click(within(finding).getByRole('button', { name: 'Fix this' }));
  await user.click(screen.getByRole('link', { name: 'Tests' }));
  await openReview(user);
  await user.click(
    within(screen.getByRole('list', { name: 'Drafts' })).getByRole('button', {
      name: 'zod 3.25.0 → 4.6.7',
    }),
  );

  expect(within(inspector()).getByRole('group', { name: 'pnpm-lock.yaml' })).toHaveProperty(
    'open',
    true,
  );
});

test("a served page's line in a file outside the graph takes a comment, named by its path", async () => {
  const user = userEvent.setup();
  const sent = vi.fn(async () => {});
  render(<ReviewPage review={pageWithUndrawnFile()} send={sent} />);

  await openUndrawnFiles(user);
  await user.click(within(inspector()).getByText('README.md'));
  await user.click(
    within(inspector()).getByRole('button', { name: 'Comment on README.md:1 "new"' }),
  );
  await write(user, within(inspector()).getByRole('textbox', { name: 'Your comment' }), 'Why new?');
  await openReview(user);
  await user.click(screen.getByRole('button', { name: 'Send to Claude' }));

  expect(sent).toHaveBeenCalledExactlyOnceWith(
    sentReview({
      verdict: 'comment',
      comments: [
        {
          anchor: { kind: 'line', id: 'README.md@head:1', text: 'new' },
          kind: 'question',
          text: 'Why new?',
        },
      ],
    }),
  );
});

test('the tray goes to a draft on a line outside the graph from any screen, opening those files at its row, each time; closing them hands the keyboard focus back to the draft', async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={pageWithUndrawnFile()} send={vi.fn(async () => {})} />);
  const name = 'README.md:1 "new"';
  const draft = () =>
    within(screen.getByRole('list', { name: 'Drafts' })).getByRole('button', { name });

  await openUndrawnFiles(user);
  await user.click(within(inspector()).getByText('README.md'));
  await user.click(within(inspector()).getByRole('button', { name: `Comment on ${name}` }));
  await write(user, within(inspector()).getByRole('textbox', { name: 'Your comment' }), 'Why new?');
  await user.click(screen.getByRole('button', { name: 'domain: unchanged' }));
  await user.click(screen.getByRole('link', { name: 'Tests' }));
  await openReview(user);

  await user.click(draft());
  const row = within(inspector()).getByRole('insertion', { current: true });
  expect(within(inspector()).getByRole('heading', { level: 2 }).textContent).toBe(
    'Changed files outside the graph',
  );
  expect(within(row).getByRole('textbox', { name: 'Your comment' })).toHaveProperty(
    'value',
    'Why new?',
  );
  expect(scrolledIntoView.mock.contexts).toContain(row);

  scrolledIntoView.mockClear();
  await user.click(draft());
  expect(scrolledIntoView.mock.contexts).toContain(row);

  await user.click(within(inspector()).getByRole('button', { name: 'Close inspector' }));
  expect(document.activeElement).toBe(draft());

  scrolledIntoView.mockClear();
  await user.click(
    within(screen.getByRole('complementary', { name: 'Findings' })).getByRole('button', {
      name: 'README.md: 1 changed file outside the graph',
    }),
  );
  expect(within(inspector()).getByRole('insertion', { current: false })).toBeDefined();
  expect(scrolledIntoView).not.toHaveBeenCalled();
});

test("going to a line's draft shows its hidden field, and leaves hidden the one on the row it left", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWithPatch('@@ -1 +1 @@', '-const x = 1;', '+const x = 2;')}
      send={vi.fn(async () => {})}
    />,
  );
  const removed = 'x.ts:1 "const x = 1;"';
  const added = 'x.ts:1 "const x = 2;"';
  const goToDraft = (name: string) =>
    user.click(within(screen.getByRole('list', { name: 'Drafts' })).getByRole('button', { name }));
  const toggle = (name: string) =>
    user.click(within(diffTab()).getByRole('button', { name: `Comment on ${name}` }));

  await user.click(await screen.findByRole('button', { name: 'x.ts: modified' }));
  await user.click(within(inspector()).getByRole('tab', { name: 'Diff' }));
  await toggle(removed);
  await write(user, within(diffTab()).getByRole('textbox', { name: 'Your comment' }), 'Why 1?');
  await toggle(removed);
  await toggle(added);
  await write(user, within(diffTab()).getByRole('textbox', { name: 'Your comment' }), 'Why 2?');
  await toggle(added);
  await openReview(user);

  await goToDraft(removed);
  const field = () => within(diffTab()).getByRole('textbox', { name: 'Your comment' });
  expect(field()).toHaveProperty('value', 'Why 1?');

  await toggle(removed);
  await goToDraft(added);
  expect(field()).toHaveProperty('value', 'Why 2?');
});

const nothingChanged = { nodes: [], edges: [], symbols: [], decisions: [], tests: [], files: [] };

const changedSince = ({
  dropped,
  ...changed
}: Partial<Omit<ChangedSince, 'dropped'>> & {
  readonly dropped?: Partial<ChangedSince['dropped']>;
}): ChangedSince => ({
  ...nothingChanged,
  ...changed,
  dropped: { ...nothingChanged, ...dropped },
});

const lastReview = { head: 'h1', verdict: 'comment' as const, comments: [], calledFine: [] };

const sinceReview = {
  ...lastReview,
  changed: changedSince({ nodes: ['rust/crate/application'] }),
  changedWithoutComment: [],
  stillRead: [],
};

test("a later round offers 'Since last review' first in Show, Changes only still picked; picked, it draws what changed since, and going to a part it hides widens Show", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({ ...review, sinceReview })}
      notes={{
        version: 1,
        tests: '',
        summary: [{ text: 'Check the CLI.', target: 'rust/crate/cli-adapter' }],
        notes: {},
      }}
    />,
  );
  const rust = await screen.findByRole('group', { name: 'rust' });
  const pressed = () =>
    within(screen.getByRole('group', { name: 'Show' }))
      .getAllByRole('button', { pressed: true })
      .map(button => button.textContent);
  expect(
    within(screen.getByRole('group', { name: 'Show' }))
      .getAllByRole('button')
      .map(button => button.textContent),
  ).toEqual(['Since last review', 'Changes only', 'Changed + 1 hop', 'Everything']);
  expect(pressed()).toEqual(['Changes only']);
  expect(within(screen.getByRole('banner')).queryByText(/commit last reviewed/)).toBeNull();

  await user.click(shown('Since last review'));

  expect(pressed()).toEqual(['Since last review']);
  await waitFor(() => expect(buttonsIn(rust)).toEqual(['application: modified']));
  expect(screen.queryByText(/so not shown/)).toBeNull();

  await user.click(
    within(screen.getByRole('region', { name: 'Summary' })).getByRole('button', {
      name: 'Check the CLI.',
    }),
  );

  expect(pressed()).toEqual(['Changes only']);
});

test.for([
  { round: 'with no earlier review', since: {} },
  { round: 'whose reviewed head is gone', since: { sinceReview: { ...lastReview, gone: true } } },
  {
    round: "whose reviewed head couldn't be read",
    since: { sinceReview: { ...lastReview, unreadable: 'cargo metadata failed' } },
  },
] as const)('a review $round has no Since last review choice', async ({ since }) => {
  render(<ReviewPage review={pageWith({ ...review, ...since })} />);
  await screen.findByRole('group', { name: 'rust' });

  expect(
    within(screen.getByRole('group', { name: 'Show' }))
      .getAllByRole('button')
      .map(button => button.textContent),
  ).toEqual(['Changes only', 'Changed + 1 hop', 'Everything']);
});

test("with 'Since last review' shown and nothing drawn changed since, the graph gives way to a line saying so", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        sinceReview: {
          ...sinceReview,
          changed: changedSince({}),
        },
      })}
    />,
  );
  await screen.findByRole('group', { name: 'rust' });

  await user.click(shown('Since last review'));

  expect(await screen.findByText(/changed since the last review/)).toBeTruthy();
});

test("'Since last review' draws an edge the PR has put back, though unchanged edges otherwise merge", async () => {
  const user = userEvent.setup();
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
            webFile('billing', 'invoice.ts'),
          ],
          edges: [webImport('orders/cart.ts', 'billing/invoice.ts', 'unchanged')],
        },
        sinceReview: {
          ...sinceReview,
          changed: changedSince({
            edges: ['web/file/orders/cart.ts -> web/file/billing/invoice.ts'],
          }),
        },
      })}
    />,
  );
  await screen.findByRole('group', { name: 'Show' });

  await user.click(shown('Since last review'));

  const web = await screen.findByRole('group', { name: 'web' });
  await user.click(within(web).getByRole('button', { name: 'Expand orders' }));
  await user.click(await within(web).findByRole('button', { name: 'Expand billing' }));

  await waitFor(() => expect(buttonsIn(web)).toContain('cart.ts → invoice.ts: unchanged'));

  await showEverything(user);

  await waitFor(() => expect(buttonsIn(web)).toContain('orders → billing: unchanged'));
  expect(buttonsIn(web)).not.toContain('cart.ts → invoice.ts: unchanged');
});

test("'Since last review' with only what it can't draw says that, not that nothing changed", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        sinceReview: {
          ...sinceReview,
          changed: changedSince({ dropped: { nodes: ['rust/crate/spike'] } }),
        },
      })}
    />,
  );
  await screen.findByRole('group', { name: 'rust' });

  await user.click(shown('Since last review'));

  await screen.findByText(/so not shown/);
  expect(screen.queryByText(/Nothing in the graph changed/)).toBeNull();
});

test("'Since last review' names what was added then and has since gone, which it can't draw", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        sinceReview: {
          ...sinceReview,
          changed: changedSince({
            nodes: ['rust/crate/application'],
            dropped: {
              nodes: ['rust/crate/spike'],
              edges: ['rust/crate/spike -> rust/crate/cli'],
              symbols: ['rust/file/gone.rs#gone'],
              decisions: ['rust/file/gone.rs#gone#if (late)'],
              tests: ['gone.test.ts#drops totals'],
              files: ['gone.rs'],
            },
          }),
        },
      })}
    />,
  );
  await screen.findByRole('group', { name: 'rust' });
  expect(screen.queryByText(/so not shown/)).toBeNull();

  await user.click(shown('Since last review'));

  const line = await screen.findByText(/so not shown/);
  expect(line.textContent).toContain(
    'rust/crate/spike, rust/crate/spike -> rust/crate/cli, rust/file/gone.rs#gone, rust/file/gone.rs#gone#if (late), gone.test.ts#drops totals, gone.rs',
  );

  await user.click(shown('Changes only'));

  expect(screen.queryByText(/so not shown/)).toBeNull();
});

const pageWithSymbolsEditedThenAndSince = () =>
  pageWith({
    range: review.range,
    diff: {
      nodes: [
        { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
        topFile('tax.ts', 'modified'),
      ],
      edges: [],
    },
    symbols: [
      symbolsOf('web/file/tax.ts', [
        {
          name: 'tax',
          kind: 'function',
          exported: { base: false, head: false },
          change: 'edited',
          logic: [
            { change: 'added', kind: 'guard', depth: 0, head: 'if (!rate) return', line: 2 },
            { change: 'added', kind: 'if', depth: 0, head: 'if (rate > 1)', line: 3 },
          ],
        },
        {
          name: 'round',
          kind: 'function',
          exported: { base: false, head: false },
          change: 'edited',
        },
      ]),
    ],
    sinceReview: {
      ...sinceReview,
      changed: changedSince({
        symbols: ['web/file/tax.ts#tax'],
        decisions: ['web/file/tax.ts#tax#if (!rate) return'],
      }),
    },
  });

test('a later round marks the symbol changed since the last review, not the one edited only before it, whatever Show holds', async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={pageWithSymbolsEditedThenAndSince()} />);

  await user.click(await screen.findByRole('button', { name: 'tax.ts: modified' }));
  await user.click(within(inspector()).getByRole('tab', { name: /^Symbols/ }));

  const since = within(symbolsTab()).getByRole('listitem', {
    name: 'function tax: edited, changed since',
  });
  expect(within(since).getAllByText('changed since')).toHaveLength(2);
  const before = within(symbolsTab()).getByRole('listitem', { name: 'function round: edited' });
  expect(within(before).queryByText('changed since')).toBeNull();

  const lineSince = within(since).getByRole('listitem', {
    name: 'added guard: if (!rate) return, changed since',
  });
  expect(within(lineSince).getByText('changed since')).toBeTruthy();
  expect(
    within(lineSince).getByRole('button', {
      name: 'added guard: if (!rate) return, changed since',
    }),
  ).toBeTruthy();
  const lineBefore = within(since).getByRole('listitem', { name: 'added if: if (rate > 1)' });
  expect(within(lineBefore).queryByText('changed since')).toBeNull();
});

test('the unchanged symbols open by themselves when one is marked changed since, as a symbol put back is', async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={{
        ...pageWithAnUnchangedSymbol(),
        sinceReview: {
          ...sinceReview,
          changed: changedSince({ symbols: ['web/file/tax.ts#round'] }),
        },
      }}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'tax.ts: modified' }));
  await user.click(within(inspector()).getByRole('tab', { name: /^Symbols/ }));

  expect(unchangedSymbols().hasAttribute('open')).toBe(true);
  expect(
    within(unchangedSymbols()).getByRole('listitem', {
      name: 'function round: unchanged, changed since',
    }),
  ).toBeTruthy();
});

test('a box shows a file whose only news is a symbol changed since the last review, not a file with no news at all', async () => {
  const user = userEvent.setup();
  const inBilling = (label: string) => ({
    ...topFile(label, 'modified'),
    parent: 'web/module/billing',
    path: `web/src/billing/${label}`,
  });
  const unchanged = (name: string): SymbolStatement => ({
    name,
    kind: 'function',
    exported: { base: false, head: false },
    change: 'unchanged',
  });
  render(
    <ReviewPage
      review={pageWith({
        range: review.range,
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
            inBilling('restored.ts'),
            inBilling('quiet.ts'),
          ],
          edges: [],
        },
        symbols: [
          symbolsOf('web/file/restored.ts', [unchanged('round')]),
          symbolsOf('web/file/quiet.ts', [unchanged('floor')]),
        ],
        sinceReview: {
          ...sinceReview,
          changed: changedSince({ symbols: ['web/file/restored.ts#round'] }),
        },
      })}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'billing: modified' }));
  await user.click(within(inspector()).getByRole('tab', { name: 'Symbols' }));

  expect(
    within(within(symbolsTab()).getByRole('region', { name: 'restored.ts' })).getByRole(
      'listitem',
      { name: 'function round: unchanged, changed since', hidden: true },
    ),
  ).toBeTruthy();
  expect(within(symbolsTab()).queryByRole('region', { name: 'quiet.ts' })).toBeNull();
});

test('a later round marks the test changed since the last review, not its namesake changed only before it', async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={{
        ...pageWithSameNamedTests(),
        sinceReview: {
          ...sinceReview,
          changed: changedSince({ tests: ['total.test.ts#Cart › adds tax'] }),
        },
      }}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'total.ts: modified' }));
  await user.click(within(inspector()).getByRole('tab', { name: 'Tests 3' }));

  const since = within(testsTab()).getByRole('listitem', {
    name: 'adds tax: added, changed since',
  });
  expect(within(since).getByText('changed since')).toBeTruthy();
  const before = within(testsTab()).getByRole('listitem', { name: 'adds tax: edited' });
  expect(within(before).queryByText('changed since')).toBeNull();

  location.hash = '#tests';
  expect(
    await within(await screen.findByRole('region', { name: 'Test changes' })).findByRole(
      'listitem',
      { name: 'adds tax: added, changed since' },
    ),
  ).toBeTruthy();
});

test('a later round marks a patch whose file changed since the last review, not one changed only before it', async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={{
        ...pageWithFilesDrawnOnlyAsABox(),
        sinceReview: {
          ...sinceReview,
          changed: changedSince({ files: ['web/src/billing/refund.ts'] }),
        },
      }}
    />,
  );
  const patch = (name: string) => within(within(diffTab()).getByRole('group', { name }));

  await user.click(await screen.findByRole('button', { name: 'billing: modified' }));
  await user.click(within(inspector()).getByRole('tab', { name: 'Diff' }));

  expect(patch('web/src/billing/refund.ts').getByText('changed since')).toBeTruthy();
  expect(patch('web/src/billing/tax.ts').queryByText('changed since')).toBeNull();
});

test('a review whose reviewed head is gone says so, with that head short, in the header, and shows the full review', async () => {
  const head = 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0';
  render(
    <ReviewPage
      review={pageWith({ ...review, sinceReview: { ...lastReview, head, gone: true } })}
    />,
  );
  await screen.findByRole('group', { name: 'rust' });

  expect(within(screen.getByRole('banner')).getByText(/is gone/).textContent).toContain(
    'a1b2c3d, is',
  );
  expect(screen.getByRole('button', { name: 'cli-adapter: added' })).toBeDefined();
});

test("a review whose reviewed head couldn't be read says so, with that head short and the reason on hover, in the header, and shows the full review", async () => {
  const head = 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0';
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        sinceReview: { ...lastReview, head, unreadable: 'cargo metadata failed' },
      })}
    />,
  );
  await screen.findByRole('group', { name: 'rust' });

  const line = within(screen.getByRole('banner')).getByText(/couldn't be read/);
  expect(line.textContent).toContain('a1b2c3d, couldn');
  expect(line.getAttribute('title')).toBe('cargo metadata failed');
  expect(screen.getByRole('button', { name: 'cli-adapter: added' })).toBeDefined();
});

test.for([
  {
    round: 'compared',
    since: { changed: sinceReview.changed, changedWithoutComment: [], stillRead: [] },
  },
  { round: 'whose head is gone', since: { gone: true } },
  { round: "whose head couldn't be read", since: { unreadable: 'cargo metadata failed' } },
] as const)(
  'a later round $round says in the header what the last review concluded, and at which head',
  async ({ since }) => {
    const head = 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0';
    render(
      <ReviewPage
        review={pageWith({
          ...review,
          sinceReview: { ...lastReview, head, verdict: 'request-changes', ...since },
        })}
      />,
    );
    await screen.findByRole('group', { name: 'rust' });

    expect(within(screen.getByRole('banner')).getByText(/Last review/).textContent).toBe(
      'Last review at a1b2c3d: Request changes',
    );
  },
);

const lastReviewSection = () => screen.getByRole('region', { name: 'Last review' });

const saidOnPart = (
  id: string,
  said: Partial<Pick<Comment, 'kind' | 'text'>> & {
    readonly target?: string;
    readonly changedSince?: ReadonlyArray<Commit>;
  } = {},
): PreviousComment => ({
  anchor: { kind: 'part', id },
  kind: 'question',
  text: 'Why?',
  target: id,
  ...said,
});

test('a later round opens the left column with what the last review said, each comment marked by what became of it, going to its anchor', async () => {
  const user = userEvent.setup();
  const sha = 'c0ffee4d5e6fa7b8c9d0a1b2c3d4e5f6a7b8c9d0';
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        sinceReview: {
          ...sinceReview,
          body: 'Nearly there.',
          comments: [
            saidOnPart('rust/crate/application', {
              kind: 'change',
              text: 'Split this.',
              changedSince: [{ sha, subject: 'split the application', files: [] }],
            }),
            saidOnPart('rust/crate/cli-adapter'),
          ],
        },
      })}
    />,
  );
  await screen.findByRole('group', { name: 'rust' });

  const last = within(lastReviewSection());
  expect(last.getByText('Nearly there.')).toBeTruthy();
  const touched = last.getByRole('listitem', {
    name: 'application: Change this, Changed since',
  });
  expect(within(touched).getByText('Split this.')).toBeTruthy();
  expect(within(touched).getByText('split the application').parentElement?.textContent).toBe(
    'c0ffee4 split the application',
  );
  expect(last.getByRole('listitem', { name: 'cli-adapter: Question, As it was' })).toBeTruthy();

  await user.click(last.getByRole('button', { name: 'cli-adapter' }));

  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'cli-adapter: added' }));
});

test.for([
  { round: 'whose head is gone', since: { gone: true } },
  { round: "whose head couldn't be read", since: { unreadable: 'cargo metadata failed' } },
] as const)('a later round $round lists the last comments with no mark', async ({ since }) => {
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        sinceReview: { ...lastReview, ...since, comments: [saidOnPart('rust/crate/application')] },
      })}
    />,
  );
  await screen.findByRole('group', { name: 'rust' });

  expect(
    within(lastReviewSection()).getByRole('listitem', { name: 'application: Question' }),
  ).toBeTruthy();
});

test('a last answer to a finding is listed by its title, going to its target; one no longer raised reads changed, naming no commit, with nowhere to go', async () => {
  const user = userEvent.setup();
  const raised: Finding = {
    id: 'metrics:look:rust/crate/application',
    check: 'metrics:lines',
    dimension: 'metrics',
    level: 'look',
    title: 'application got harder',
    target: 'rust/crate/application',
  };
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        findings: [raised],
        sinceReview: {
          ...sinceReview,
          comments: [
            {
              anchor: { kind: 'finding', id: raised.id },
              kind: 'fine',
              text: 'Worth it.',
              target: 'rust/crate/application',
            },
            { anchor: { kind: 'finding', id: 'logic:old' }, kind: 'fix', changedSince: [] },
          ],
        },
      })}
    />,
  );
  await screen.findByRole('group', { name: 'rust' });

  const last = within(lastReviewSection());
  const answered = last.getByRole('listitem', {
    name: "application got harder: It's fine, As it was",
  });
  expect(within(answered).getByText('Worth it.')).toBeTruthy();
  const gone = last.getByRole('listitem', { name: 'logic:old: Fix this, Changed since' });
  expect(within(gone).queryByRole('button')).toBeNull();
  expect(within(gone).queryByRole('list')).toBeNull();

  await user.click(last.getByRole('button', { name: 'application got harder' }));

  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'application: modified' }),
  );
});

test('a last comment on a line outside the graph goes to its row in the files outside it', async () => {
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
  await screen.findByRole('group', { name: 'rust' });

  await user.click(within(lastReviewSection()).getByRole('button', { name: 'README.md:1 "new"' }));

  expect(within(inspector()).getByRole('heading', { level: 2 }).textContent).toBe(
    'Changed files outside the graph',
  );
  expect(within(inspector()).getByRole('insertion', { current: true }).textContent).toContain(
    'new',
  );
});

test('a later round with nothing said and nothing changed without a comment has no last review section', async () => {
  render(<ReviewPage review={pageWith({ ...review, sinceReview })} />);
  await screen.findByRole('group', { name: 'rust' });

  expect(screen.queryByRole('region', { name: 'Last review' })).toBeNull();
});

test("a last comment on a part renamed since goes by the part's name at the head", async () => {
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        sinceReview: {
          ...sinceReview,
          comments: [
            {
              anchor: { kind: 'part', id: 'rust/crate/old-name' },
              kind: 'question',
              text: 'Why?',
              target: 'rust/crate/application',
              changedSince: [],
            },
            {
              anchor: { kind: 'edge', id: 'rust/crate/old-name -> rust/crate/domain' },
              kind: 'question',
              text: 'Why?',
              target: 'rust/crate/application -> rust/crate/domain',
            },
            {
              anchor: { kind: 'symbol', id: 'rust/crate/application#run' },
              kind: 'question',
              text: 'Why?',
              target: 'rust/crate/application',
            },
          ],
        },
      })}
    />,
  );
  await screen.findByRole('group', { name: 'rust' });

  const last = within(lastReviewSection());
  expect(last.getByRole('button', { name: 'application' })).toBeTruthy();
  expect(last.getByRole('button', { name: 'application → domain' })).toBeTruthy();
  expect(last.getByRole('button', { name: 'run in application' })).toBeTruthy();
});

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

test('the last review lists what Claude changed unasked, going to each part or edge; with only those it still shows', async () => {
  const user = userEvent.setup();
  const edge = 'rust/crate/cli-adapter -> rust/crate/application';
  render(
    <ReviewPage
      review={pageWith({ ...review, sinceReview })}
      notes={{
        version: 1,
        tests: '',
        summary: [],
        notes: {},
        unasked: {
          'rust/crate/application': { text: 'Renamed the helper.' },
          [edge]: { text: 'Dropped a cast.' },
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
});

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
        version: 1,
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
  expect(within(noteTab()).getByRole('textbox', { name: 'Your comment' })).toBeTruthy();

  await user.click(screen.getByRole('button', { name: 'application: modified' }));
  expect(within(noteTab()).getByRole('button', { name: 'Reply' })).toBeTruthy();
  expect(within(noteTab()).queryByRole('textbox', { name: 'Your comment' })).toBeNull();
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
  await user.click(within(noteTab()).getByRole('button', { name: 'Reply' }));
  expect(within(noteTab()).getByRole('textbox', { name: 'Your comment' })).toBeTruthy();

  await user.click(screen.getByRole('button', { name: 'domain: unchanged' }));
  expect(within(noteTab()).getByRole('button', { name: 'Reply' })).toBeTruthy();
  expect(within(noteTab()).queryByRole('textbox', { name: 'Your comment' })).toBeNull();

  await openReview(user);
  const tray = within(screen.getByRole('region', { name: 'Review tray' }));
  await user.click(tray.getByRole('button', { name: 'application' }));
  expect(within(noteTab()).getByRole<HTMLTextAreaElement>('textbox').value).toBe('Still?');
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
  await user.click(within(inspector()).getByRole('tab', { name: /^Symbols/ }));

  const symbol = within(symbolsTab()).getByRole('listitem', { name: /^function tax: edited/ });
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
  await user.click(within(inspector()).getByRole('tab', { name: 'Diff' }));

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
  await user.click(within(inspector()).getByRole('tab', { name: 'Diff' }));

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
  await user.click(within(inspector()).getByRole('tab', { name: 'Diff' }));
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
      notes={{ version: 1, tests: '', summary: [], notes: { [checkout]: { text: 'Paid.' } } }}
    />,
  );
  await showEverything(user);
  const web = await screen.findByRole('group', { name: 'web' });
  const said = (text: string) => within(noteTab()).queryByText(text);

  await user.click(within(web).getByRole('button', { name: 'orders → billing: unchanged' }));
  expect(said('Why the cart?')).toBeTruthy();
  expect(said('Why the checkout?')).toBeTruthy();
  expect(within(noteTab()).getByText('cart.ts → invoice.ts')).toBeTruthy();

  await user.click(within(web).getByRole('button', { name: 'Expand orders' }));
  await user.click(within(web).getByRole('button', { name: 'Expand billing' }));
  await within(web).findByRole('group', { name: 'billing' });
  await user.click(await within(web).findByRole('button', { name: 'orders → billing: unchanged' }));
  expect(said('Why the cart?')).toBeTruthy();
  expect(said('Why the checkout?')).toBeNull();

  await user.click(
    await within(web).findByRole('button', { name: 'checkout.ts → invoice.ts: unchanged' }),
  );
  expect(said('Why the checkout?')).toBeTruthy();
  expect(said('Why the cart?')).toBeNull();

  await user.click(screen.getByRole('checkbox', { name: 'All edges' }));
  await user.click(within(web).getByRole('button', { name: 'Collapse orders' }));
  await user.click(
    await within(web).findByRole('button', { name: 'orders → invoice.ts: unchanged' }),
  );
  expect(said('Why the cart?')).toBeTruthy();
  expect(said('Why the checkout?')).toBeTruthy();
});

test('a last comment on a symbol or a logic line shows under it on the Symbols tab, with no send too', async () => {
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
  await user.click(within(inspector()).getByRole('tab', { name: /^Symbols/ }));

  const symbol = within(symbolsTab()).getByRole('listitem', { name: /^function tax: edited/ });
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

test('a last comment on an unchanged symbol brings up the Symbols tab and opens the unchanged ones', async () => {
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
  await user.click(within(inspector()).getByRole('tab', { name: /^Symbols/ }));

  expect(unchangedSymbols().hasAttribute('open')).toBe(true);
  expect(within(unchangedSymbols()).getByText('Why not?')).toBeTruthy();
});

test("a last comment on a test shows under it on the Tests screen and the inspector's Tests tab, with no send too", async () => {
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
  await user.click(within(inspector()).getByRole('tab', { name: 'Tests 3' }));
  expect(within(said(testsTab())).getByText('Why gone?')).toBeTruthy();

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
  await user.click(within(inspector()).getByRole('tab', { name: 'Diff' }));

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

const pageWithAnAnsweredFinding = (
  since: Partial<Pick<SinceReview, 'calledFine' | 'comments'>>,
) => {
  const finding = (id: string, title: string): Finding => ({
    id,
    check: 'logic:changed',
    dimension: 'logic',
    level: 'look',
    target: 'rust/crate/application',
    title,
    detail: 'in tax',
  });
  return pageWith({
    ...review,
    findings: [finding('logic:a', 'lost a guard'), finding('logic:b', 'changed a branch')],
    sinceReview: { ...sinceReview, ...since },
  });
};

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

test('a finding called fine at the last review stays out of Start here and reads so in its group', async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={pageWithAnAnsweredFinding({ calledFine: ['logic:a'] })} />);

  const band = within(await screen.findByRole('region', { name: 'Start here' }));
  expect(band.getByRole('button', { name: /^application: changed a branch/ })).toBeTruthy();
  expect(band.queryByRole('button', { name: /lost a guard/ })).toBeNull();

  await user.click(screen.getByRole('button', { name: 'Show 2 findings' }));
  const group = within(screen.getByRole('region', { name: 'Logic' }));
  expect(
    group.getByRole('button', { name: /^application: lost a guard.*, called fine$/ }),
  ).toBeTruthy();
  expect(group.getByRole('button', { name: /^application: changed a branch.*[^e]$/ })).toBeTruthy();
  expect(group.getAllByText('called fine')).toHaveLength(1);
});
