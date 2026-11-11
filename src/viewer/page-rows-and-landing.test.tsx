// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, onTestFinished, test, vi } from 'vitest';
import type { Finding } from '../core/findings.ts';
import type { SymbolStatement } from '../core/symbol-changes.ts';
import { findingOn, pageWith } from '../test-support/page-data.ts';
import {
  addedIfs,
  at,
  atHash,
  buttonsIn,
  changedSince,
  closeAndReopen,
  diffTab,
  fullDiffOpen,
  inspector,
  lastReview,
  lastReviewSection,
  logicRowsOf,
  openFold,
  openReview,
  openUndrawnFiles,
  pageWithAnUnchangedSymbol,
  pageWithFilesDrawnOnlyAsABox,
  pageWithLockfile,
  pageWithManyDecisions,
  pageWithPatch,
  pageWithSameNamedTests,
  pageWithSymbolsEditedThenAndSince,
  pageWithUnchangedRuns,
  pageWithUndrawnFile,
  partComment,
  patchOf,
  review,
  saidOnPart,
  scrolledBy,
  scrolledIntoView,
  scrolledTo,
  selectedPart,
  sentReview,
  showEverything,
  shown,
  sinceReview,
  symbolsOf,
  testedBy,
  topFile,
  tray,
  unchangedIf,
  unchangedRun,
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

test("a served page's Tests screen takes a comment on a test row, one draft with the column's Tested by; a page not served has no toggle", async () => {
  const user = userEvent.setup();
  const page = pageWithSameNamedTests();
  const { rerender } = render(<ReviewPage review={page} send={vi.fn(async () => {})} />);
  const row = (place: HTMLElement, rowName: string) =>
    within(within(place).getByRole('listitem', { name: rowName }));
  const testChanges = () => screen.getByRole('region', { name: 'Test changes' });

  await user.click(await screen.findByRole('button', { name: 'total.ts: modified' }));
  await user.click(
    row(testedBy(), 'adds tax: added').getByRole('button', { name: 'Comment on Cart › adds tax' }),
  );
  await write(
    user,
    row(testedBy(), 'adds tax: added').getByRole('textbox', { name: 'Your comment' }),
    'From the column.',
  );

  await user.click(screen.getByRole('link', { name: 'Tests 3' }));
  expect(
    row(testChanges(), 'adds tax: added').getByRole('textbox', { name: 'Your comment' }),
  ).toHaveProperty('value', 'From the column.');
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
  expect(
    row(testedBy(), 'drops totals: removed').getByRole('textbox', { name: 'Your comment' }),
  ).toHaveProperty('value', 'From the screen.');

  await user.click(screen.getByRole('link', { name: 'Tests 3' }));
  rerender(<ReviewPage review={page} />);
  expect(within(testChanges()).queryAllByRole('button', { name: /^Comment on/ })).toStrictEqual([]);
});

test('two tests of one name under one heading keep a draft each, in Tested by and on the Tests screen, and the review sends each on its own id', async () => {
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
  await user.click(twin(testedBy(), 0).getByRole('button', { name: 'Comment on Cart › adds tax' }));
  await write(user, field(testedBy(), 0), 'The first.');
  await user.click(
    twin(testedBy(), 1).getByRole('button', { name: 'Comment on Cart › adds tax#2' }),
  );
  expect(field(testedBy(), 1)).toHaveProperty('value', '');

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

test("a test's draft in the tray opens Tested by on the file it's named after, though no box holds it, showing the draft", async () => {
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
    within(within(testedBy()).getByRole('listitem', { name: 'adds tax: added' })).getByRole(
      'textbox',
      { name: 'Your comment' },
    );

  await user.click(await screen.findByRole('button', { name: 'total.ts: modified' }));
  await user.click(within(testedBy()).getByRole('button', { name: 'Comment on adds tax' }));
  await write(user, rowField(), 'Which rate?');
  await user.click(screen.getByRole('button', { name: 'Close inspector' }));
  await openReview(user);

  await user.click(
    within(screen.getByRole('list', { name: 'Drafts' })).getByRole('button', { name: 'adds tax' }),
  );
  expect(rowField()).toHaveProperty('value', 'Which rate?');
});

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
  await openFold(user, 'Full diff');
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

test("the tray goes to a diff line's draft in Full diff, landing on its row on its side, each time", async () => {
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
  await openFold(user, 'Full diff');
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
  scrolledIntoView.mockImplementationOnce(() => {
    inspector().scrollTop = 300;
  });
  await goToDraft();
  expect(scrolledIntoView.mock.contexts).toContain(row);
  expect(inspector().scrollTop).toBe(300);

  const patch = within(diffTab()).getByRole('group', { name: 'web/src/x.ts' });
  await user.click(within(patch).getByText('web/src/x.ts'));
  expect(patch.hasAttribute('open')).toBe(false);
  const shownWhenScrolled = vi.fn();
  scrolledIntoView.mockImplementationOnce(() => shownWhenScrolled(patch.hasAttribute('open')));
  await goToDraft();
  expect(shownWhenScrolled.mock.calls).toStrictEqual([[true]]);
});

test('Full diff opens by itself on a part holding a line draft, and stays closed once closed there until the part is left or the draft gone to', async () => {
  const user = userEvent.setup();
  const onePatch = pageWithPatch('@@ -1 +1 @@', '-const x = 1;', '+const x = 2;');
  render(
    <ReviewPage
      review={{
        ...onePatch,
        diff: {
          ...onePatch.diff,
          nodes: [...onePatch.diff.nodes, topFile('y.ts', 'modified')],
        },
        patches: [...onePatch.patches, patchOf('web/src/y.ts', '@@ -1 +1 @@', '-1', '+2')],
        findings: [findingOn(topFile('x.ts', 'modified').id)],
      }}
      send={vi.fn(async () => {})}
    />,
  );
  const name = 'x.ts:1 "const x = 1;"';
  const toggleFullDiff = () =>
    user.click(within(inspector()).getByRole('button', { name: 'Full diff' }));
  const part = await screen.findByRole('button', { name: 'x.ts: modified' });

  await user.click(part);
  expect(fullDiffOpen()).toBe(false);
  await toggleFullDiff();
  await user.click(within(diffTab()).getByRole('button', { name: `Comment on ${name}` }));
  await write(user, within(diffTab()).getByRole('textbox', { name: 'Your comment' }), 'Why 1?');
  await user.click(screen.getByRole('button', { name: 'Close inspector' }));

  await user.click(part);
  expect(fullDiffOpen()).toBe(true);

  await toggleFullDiff();
  expect(fullDiffOpen()).toBe(false);
  expect(within(diffTab()).queryByRole('group')).toBeNull();

  await user.click(screen.getByRole('button', { name: 'y.ts: modified' }));
  await user.click(part);
  expect(fullDiffOpen()).toBe(true);
  await toggleFullDiff();

  await openReview(user);
  await user.click(
    within(screen.getByRole('list', { name: 'Drafts' })).getByRole('button', { name }),
  );
  expect(fullDiffOpen()).toBe(true);

  await toggleFullDiff();
  await user.click(screen.getByRole('button', { name: 'y.ts: modified' }));
  expect(fullDiffOpen()).toBe(false);
  await user.click(part);
  expect(fullDiffOpen()).toBe(true);

  await toggleFullDiff();
  await user.click(screen.getByRole('button', { name: 'Show 1 finding' }));
  const finding = within(screen.getByRole('complementary', { name: 'Findings' })).getByRole(
    'button',
    { name: 'x.ts: lines 900, over 800' },
  );
  await user.click(finding);
  expect(within(inspector()).getByRole('listitem', { current: true })).toBeTruthy();
  expect(fullDiffOpen()).toBe(false);
  await user.click(
    within(screen.getByRole('list', { name: 'Drafts' })).getByRole('button', { name }),
  );
  expect(fullDiffOpen()).toBe(true);
  await toggleFullDiff();
  expect(fullDiffOpen()).toBe(false);
  await user.click(finding);
  expect(fullDiffOpen()).toBe(false);

  const partOpener = () => within(inspector()).getByRole('button', { name: 'Comment on x.ts' });
  await user.click(partOpener());
  await write(user, within(inspector()).getByRole('textbox', { name: 'Your comment' }), 'Why?');
  await user.click(partOpener());
  await user.click(
    within(screen.getByRole('list', { name: 'Drafts' })).getByRole('button', { name }),
  );
  expect(fullDiffOpen()).toBe(true);
  expect(partOpener().getAttribute('aria-expanded')).toBe('false');
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
  await openFold(user, 'Full diff');
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

test("a dependencies finding opens its lockfile's patch in Full diff on the node holding it, at its top", async () => {
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
  expect(fullDiffOpen()).toBe(true);
  const patch = within(inspector()).getByRole('group', { name: path });
  expect(patch.hasAttribute('open')).toBe(true);
  expect(scrolledIntoView.mock.contexts).toContain(patch);
});

test("an answer to a dependencies finding goes from the tray to its lockfile's patch, from any screen, and the patch's top, taller than the tray leaves, doesn't lift the page", async () => {
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
  const everything = vi.spyOn(Element.prototype, 'getBoundingClientRect');
  onTestFinished(() => everything.mockRestore());
  everything.mockReturnValue(at(100, 2000));
  vi.spyOn(
    screen.getByRole('region', { name: 'Review tray' }),
    'getBoundingClientRect',
  ).mockReturnValue(at(464, 800));
  scrolledBy.mockClear();
  await user.click(
    within(screen.getByRole('list', { name: 'Drafts' })).getByRole('button', {
      name: 'zod 3.25.0 → 4.6.7',
    }),
  );
  expect(scrolledBy).not.toHaveBeenCalled();

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
  await write(user, await partComment(user), 'Why new?');
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
  await write(user, await partComment(user), 'Why new?');
  await user.click(await screen.findByRole('button', { name: 'domain: unchanged' }));
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

test('landing on a row puts the page back where it stood, and with no review tray lifts it no further', async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={{ ...walkedReview(), findings: [findingOn('rust/crate/domain')] }} />);
  await user.click(await screen.findByRole('button', { name: 'Show 1 finding' }));
  const scrollY = vi.spyOn(window, 'scrollY', 'get');
  onTestFinished(() => scrollY.mockRestore());
  scrollY.mockReturnValue(250);
  scrolledTo.mockClear();
  scrolledBy.mockClear();

  await user.click(
    within(screen.getByRole('complementary', { name: 'Findings' })).getByRole('button', {
      name: /^domain/,
    }),
  );

  expect(within(inspector()).getByRole('listitem', { current: true })).toBeDefined();
  expect(scrolledTo).toHaveBeenCalledWith(0, 250);
  expect(scrolledBy).not.toHaveBeenCalled();
});

test('landing on a row the review tray covers lifts the page just clear of it, one above the window brings it back, and one in view moves nothing', async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={pageWithUndrawnFile()} send={vi.fn(async () => {})} />);
  const name = 'README.md:1 "new"';
  await openUndrawnFiles(user);
  await user.click(within(inspector()).getByText('README.md'));
  await user.click(within(inspector()).getByRole('button', { name: `Comment on ${name}` }));
  await write(user, await partComment(user), 'Why new?');
  await openReview(user);
  const landOnDraft = () =>
    user.click(within(screen.getByRole('list', { name: 'Drafts' })).getByRole('button', { name }));
  await landOnDraft();
  const row = within(inspector()).getByRole('insertion', { current: true });
  const rowAt = vi.spyOn(row, 'getBoundingClientRect');
  vi.spyOn(
    screen.getByRole('region', { name: 'Review tray' }),
    'getBoundingClientRect',
  ).mockReturnValue(at(464, 800));

  scrolledBy.mockClear();
  rowAt.mockReturnValue(at(490, 600));
  await landOnDraft();
  expect(scrolledBy.mock.calls).toEqual([[0, 136]]);

  scrolledBy.mockClear();
  rowAt.mockReturnValue(at(300, 464));
  await landOnDraft();
  expect(scrolledBy).not.toHaveBeenCalled();

  scrolledBy.mockClear();
  rowAt.mockReturnValue(at(-120, -20));
  await landOnDraft();
  expect(scrolledBy.mock.calls).toEqual([[0, -120]]);
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
  await openFold(user, 'Full diff');
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

test("a file of many changed decisions leaves its functions' rows folded under their strips, opened by hand", async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={pageWithManyDecisions()} />);

  await user.click(await screen.findByRole('button', { name: 'many.ts: modified' }));
  expect(logicRowsOf('big').hasAttribute('open')).toBe(false);
  expect(logicRowsOf('small').hasAttribute('open')).toBe(false);

  await user.click(within(logicRowsOf('big')).getByText('5 of 5'));
  expect(logicRowsOf('big').hasAttribute('open')).toBe(true);
  expect(logicRowsOf('small').hasAttribute('open')).toBe(false);
});

test.for([
  {
    news: 'a decision changed since the last review',
    since: {
      changed: changedSince({ decisions: ['web/file/many.ts#small#if (small0)'] }),
    },
  },
  {
    news: "the last review's comment on a decision",
    since: {
      comments: [
        {
          anchor: {
            kind: 'decision',
            id: 'web/file/many.ts#small#if (small0)',
            text: 'if (small0)',
          },
          kind: 'question',
          text: 'Why?',
          changedSince: [],
        },
      ],
    },
  },
] as const)('$news opens its function among many', async ({ since }) => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={{ ...pageWithManyDecisions(), sinceReview: { ...sinceReview, ...since } }}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'many.ts: modified' }));
  expect(logicRowsOf('small').hasAttribute('open')).toBe(true);
  expect(logicRowsOf('big').hasAttribute('open')).toBe(false);
});

test('a draft on a decision opens its function among many when the part is picked again', async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={pageWithManyDecisions()} send={vi.fn(async () => {})} />);

  await user.click(await screen.findByRole('button', { name: 'many.ts: modified' }));
  await user.click(within(logicRowsOf('small')).getByText('4 of 4'));
  await user.click(
    within(logicRowsOf('small')).getByRole('button', { name: 'Comment on added if: if (small0)' }),
  );
  await write(
    user,
    within(logicRowsOf('small')).getByRole('textbox', { name: 'Your comment' }),
    'Why?',
  );
  await closeAndReopen(user, 'many.ts: modified');

  expect(logicRowsOf('small').hasAttribute('open')).toBe(true);
  expect(logicRowsOf('big').hasAttribute('open')).toBe(false);
});

test("a function's unchanged runs fold into their counts, opened by hand, its changed rows and strip staying whole", async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={pageWithUnchangedRuns()} />);

  await user.click(await screen.findByRole('button', { name: 'runs.ts: modified' }));
  const logic = within(whatChanged()).getByRole('list', { name: 'Logic of function runs' });
  expect(within(logic).getByRole('listitem', { name: 'added if: if (c)' })).toBeTruthy();
  expect(unchangedRun(2).hasAttribute('open')).toBe(false);
  expect(unchangedRun(1).hasAttribute('open')).toBe(false);
  expect(
    within(
      within(whatChanged()).getByRole('group', { name: 'Marks of function runs' }),
    ).getAllByRole('button'),
  ).toHaveLength(4);

  await user.click(within(unchangedRun(2)).getByText(/2 unchanged/));
  expect(unchangedRun(2).hasAttribute('open')).toBe(true);
  expect(unchangedRun(1).hasAttribute('open')).toBe(false);
  expect(within(unchangedRun(2)).getByRole('listitem', { name: 'same if: if (b)' })).toBeTruthy();
});

test("a decision's note shows under its logic row and no other, opening its function's rows and the run holding it", async () => {
  const user = userEvent.setup();
  const big = addedIfs('big', 9);
  render(
    <ReviewPage
      review={{
        ...pageWithManyDecisions(),
        symbols: [
          symbolsOf('web/file/many.ts', [
            { ...big, logic: [...(big.logic ?? []), unchangedIf('kept', 10)] },
          ]),
        ],
      }}
      notes={{
        version: 2,
        tests: '',
        summary: [],
        notes: { 'decision web/file/many.ts#big#if (kept)': { text: 'Kept for old callers.' } },
      }}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'many.ts: modified' }));

  expect(logicRowsOf('big').hasAttribute('open')).toBe(true);
  expect(unchangedRun(1).hasAttribute('open')).toBe(true);
  expect(
    within(within(whatChanged()).getByRole('listitem', { name: 'same if: if (kept)' })).getByRole(
      'region',
      { name: 'Note on same if: if (kept)' },
    ).textContent,
  ).toBe('Kept for old callers.');
  expect(within(whatChanged()).getAllByRole('region', { name: /^Note on/ })).toHaveLength(1);
});

test("on a served page Take on a decision's note opens that row's field with the recommendation as a change, focused, and hides while the draft holds text", async () => {
  const user = userEvent.setup();
  const big = addedIfs('big', 9);
  render(
    <ReviewPage
      review={{
        ...pageWithManyDecisions(),
        symbols: [
          symbolsOf('web/file/many.ts', [
            { ...big, logic: [...(big.logic ?? []), unchangedIf('kept', 10)] },
          ]),
        ],
      }}
      notes={{
        version: 2,
        tests: '',
        summary: [],
        notes: {
          'decision web/file/many.ts#big#if (kept)': {
            text: 'Kept for old callers.',
            recommendation: 'Drop it.',
          },
        },
      }}
      send={async () => {}}
    />,
  );
  const keptRow = () => within(whatChanged()).getByRole('listitem', { name: 'same if: if (kept)' });
  const field = () => within(keptRow()).getByRole('textbox', { name: 'Your comment' });
  const takeInRow = () => within(keptRow()).queryByRole('button', { name: 'Take' });

  await user.click(await screen.findByRole('button', { name: 'many.ts: modified' }));
  await user.click(within(keptRow()).getByRole('button', { name: 'Take' }));

  expect(document.activeElement).toBe(field());
  expect(field()).toHaveProperty('value', 'Drop it.');
  expect(
    within(within(keptRow()).getByRole('radiogroup', { name: 'Comment kind' })).getByRole('radio', {
      name: 'Change this',
    }),
  ).toHaveProperty('checked', true);
  expect(within(tray()).getByText('1 drafted · 1 change')).toBeDefined();
  expect(takeInRow()).toBeNull();
  await openReview(user);
  expect(
    within(screen.getByRole('list', { name: 'Drafts' })).getByRole('button', { name: 'if (kept)' }),
  ).toBeTruthy();

  await user.clear(field());
  expect(takeInRow()).not.toBeNull();
});

test("the last review's comment on an unchanged decision opens its whole run, and no other", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={{
        ...pageWithUnchangedRuns(),
        sinceReview: {
          ...sinceReview,
          comments: [
            {
              anchor: { kind: 'decision', id: 'web/file/runs.ts#runs#if (a)', text: 'if (a)' },
              kind: 'question',
              text: 'Why?',
              changedSince: [],
            },
          ],
        },
      }}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'runs.ts: modified' }));
  expect(unchangedRun(2).hasAttribute('open')).toBe(true);
  expect(unchangedRun(1).hasAttribute('open')).toBe(false);
});

test('a tick opens its function and its run at its row, ringed in the strip and landed on in the rows, and only that one', async () => {
  const user = userEvent.setup();
  const big = addedIfs('big', 9);
  render(
    <ReviewPage
      review={{
        ...pageWithManyDecisions(),
        symbols: [
          symbolsOf('web/file/many.ts', [
            { ...big, logic: [...(big.logic ?? []), unchangedIf('kept', 10)] },
            addedIfs('small', 1),
          ]),
        ],
      }}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'many.ts: modified' }));
  const tick = () =>
    within(within(whatChanged()).getByRole('group', { name: 'Marks of function big' })).getByRole(
      'button',
      { name: 'same if: if (kept)' },
    );
  expect(logicRowsOf('big').hasAttribute('open')).toBe(false);
  expect(unchangedRun(1).hasAttribute('open')).toBe(false);

  await user.click(tick());
  expect(logicRowsOf('big').hasAttribute('open')).toBe(true);
  expect(logicRowsOf('small').hasAttribute('open')).toBe(false);
  expect(unchangedRun(1).hasAttribute('open')).toBe(true);
  const row = within(unchangedRun(1)).getByRole('listitem', { name: 'same if: if (kept)' });
  expect(row.getAttribute('aria-current')).toBe('true');
  expect(document.activeElement).toBe(row);
  expect(tick().getAttribute('aria-current')).toBe('true');
  expect(whatChanged().querySelectorAll('[aria-current="true"]')).toHaveLength(2);
});

test('a tick leaves the Full diff a logic line opened as it is, open, or closed by hand', async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={{
        ...pageWithUnchangedRuns(),
        patches: [
          {
            path: 'web/src/runs.ts',
            patch: [
              'diff --git a/web/src/runs.ts b/web/src/runs.ts',
              '@@ -1 +1,2 @@',
              ' if (a) {',
              '+if (c) {',
            ].join('\n'),
          },
        ],
      }}
    />,
  );
  await user.click(await screen.findByRole('button', { name: 'runs.ts: modified' }));
  const logic = within(whatChanged()).getByRole('list', { name: 'Logic of function runs' });

  await user.click(within(logic).getByRole('button', { name: 'added if: if (c)' }));
  expect(fullDiffOpen()).toBe(true);

  const tick = (name: string) =>
    user.click(
      within(
        within(whatChanged()).getByRole('group', { name: 'Marks of function runs' }),
      ).getByRole('button', { name }),
    );
  await tick('same if: if (a)');
  expect(fullDiffOpen()).toBe(true);

  await user.click(within(inspector()).getByRole('button', { name: 'Full diff' }));
  expect(fullDiffOpen()).toBe(false);
  await tick('added if: if (c)');
  expect(fullDiffOpen()).toBe(false);
});

test('the tray goes to a draft on a decision, ringing its tick', async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={pageWithUnchangedRuns()} send={vi.fn(async () => {})} />);
  await user.click(await screen.findByRole('button', { name: 'runs.ts: modified' }));
  await user.click(
    within(whatChanged()).getByRole('button', { name: 'Comment on added if: if (c)' }),
  );
  await write(user, within(whatChanged()).getByRole('textbox', { name: 'Your comment' }), 'Why?');
  await openReview(user);

  await user.click(
    within(screen.getByRole('list', { name: 'Drafts' })).getByRole('button', { name: 'if (c)' }),
  );

  const marks = within(whatChanged()).getByRole('group', { name: 'Marks of function runs' });
  expect(
    within(marks).getByRole('button', { name: 'added if: if (c)' }).getAttribute('aria-current'),
  ).toBe('true');
  expect(marks.querySelectorAll('[aria-current="true"]')).toHaveLength(1);
});

test("C on a logic row, landed on by its tick or focused through its line, opens that row's comment, not the part's", async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={pageWithUnchangedRuns()} send={vi.fn(async () => {})} />);
  const rowField = (name: string) =>
    within(within(whatChanged()).getByRole('listitem', { name })).findByRole('textbox', {
      name: 'Your comment',
    });

  await user.click(await screen.findByRole('button', { name: 'runs.ts: modified' }));
  await user.click(
    within(within(whatChanged()).getByRole('group', { name: 'Marks of function runs' })).getByRole(
      'button',
      { name: 'same if: if (b)' },
    ),
  );
  await user.keyboard('c');
  expect(document.activeElement).toBe(await rowField('same if: if (b)'));

  within(within(whatChanged()).getByRole('list', { name: 'Logic of function runs' }))
    .getByRole('button', { name: 'added if: if (c)' })
    .focus();
  await user.keyboard('c');
  expect(document.activeElement).toBe(await rowField('added if: if (c)'));
  expect(within(inspector()).getAllByRole('textbox', { name: 'Your comment' })).toHaveLength(2);
});

test("a later round offers 'Since last review' first in Show, Changes only still picked; picked, it draws what changed since, and going to a part it hides widens Show", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({ ...review, sinceReview })}
      notes={{
        version: 2,
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

test('a later round marks the symbol changed since the last review, not the one edited only before it, whatever Show holds', async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={pageWithSymbolsEditedThenAndSince()} />);

  await user.click(await screen.findByRole('button', { name: 'tax.ts: modified' }));

  const since = within(whatChanged()).getByRole('listitem', {
    name: 'function tax: edited, changed since',
  });
  expect(within(since).getAllByText('changed since')).toHaveLength(2);
  const before = within(whatChanged()).getByRole('listitem', { name: 'function round: edited' });
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
    lines: {},
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

  expect(
    within(within(whatChanged()).getByRole('region', { name: 'restored.ts' })).getByRole(
      'listitem',
      { name: 'function round: unchanged, changed since', hidden: true },
    ),
  ).toBeTruthy();
  expect(within(whatChanged()).queryByRole('region', { name: 'quiet.ts' })).toBeNull();
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

  const since = within(testedBy()).getByRole('listitem', {
    name: 'adds tax: added, changed since',
  });
  expect(within(since).getByText('changed since')).toBeTruthy();
  const before = within(testedBy()).getByRole('listitem', { name: 'adds tax: edited' });
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
  await openFold(user, 'Full diff');

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

test('a last answer to a finding is listed by its title, going to its row at its target; one no longer raised reads changed, naming no commit, with nowhere to go, unless it keeps a target, whose graph node takes the focus', async () => {
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
            {
              anchor: { kind: 'finding', id: 'notes:part rust/crate/dropped' },
              kind: 'fix',
              target: 'rust/crate/domain',
            },
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

  expect(selectedPart()).toBe('application');
  expect(document.activeElement).toBe(
    within(within(inspector()).getByRole('region', { name: 'Why look' })).getByRole('listitem', {
      current: true,
    }),
  );

  await user.click(last.getByRole('button', { name: 'notes:part rust/crate/dropped' }));

  expect(selectedPart()).toBe('domain');
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'domain: unchanged' }));
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
