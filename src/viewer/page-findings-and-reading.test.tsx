// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, onTestFinished, test, vi } from 'vitest';
import type { Finding } from '../core/findings.ts';
import { findingOn, measured, pageWith } from '../test-support/page-data.ts';
import { layoutDiff } from './layout.ts';
import {
  allEdges,
  at,
  commentKind,
  currentTab,
  dependency,
  diffTab,
  findingInRail,
  findingsOnFiles,
  findingsShown,
  headingOfPart,
  inspector,
  lensChips,
  lenses,
  lensRow,
  noteLines,
  noteShown,
  openFold,
  openInformation,
  openReview,
  pageWithPatch,
  partComment,
  pickKind,
  readingOrder,
  readRows,
  renderInFrame,
  review,
  rowsOf,
  saidOnPart,
  scrolledBy,
  scrolledIntoView,
  selectedPart,
  sentReview,
  showEverything,
  sinceReview,
  suggestedVerdict,
  take,
  tray,
  verdict,
  viewOf,
  walkedReview,
  webFile,
  webFilesReview,
  webModule,
  write,
} from './review-page.fixtures.tsx';
import { ReviewPage } from './review-page.tsx';
import { aroundPart, boxOf, centred, frameHeight, mapHeight } from './view.ts';

afterEach(() => history.replaceState(null, '', location.pathname));

test('a note says why under its text and what to do under that, on a part and on an edge, and a note without them or "No note" says neither', async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({ ...review })}
      notes={{
        version: 2,
        tests: '',
        summary: [],
        notes: {
          'part rust/crate/application': {
            text: 'Adds the export use case.',
            why: 'Exports were done by hand.',
            recommendation: 'Name the export format in the use case.',
          },
          'part rust/crate/cli-adapter': { text: 'A second way in.' },
          'edge rust/crate/cli-adapter -> rust/crate/application': {
            text: 'The CLI drives the use case.',
            why: 'The use case has no other caller yet.',
            recommendation: 'Keep the CLI out of the domain.',
          },
        },
      }}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'application: modified' }));
  expect(noteLines()).toEqual([
    'Adds the export use case.',
    'Why Exports were done by hand.',
    'Recommendation Name the export format in the use case.',
  ]);
  expect(take()).toBeNull();

  await user.click(screen.getByRole('button', { name: 'cli-adapter → application: added' }));
  expect(noteLines()).toEqual([
    'The CLI drives the use case.',
    'Why The use case has no other caller yet.',
    'Recommendation Keep the CLI out of the domain.',
  ]);

  await user.click(screen.getByRole('button', { name: 'cli-adapter: added' }));
  expect(noteLines()).toEqual(['A second way in.']);

  await user.click(screen.getByRole('button', { name: 'domain: unchanged' }));
  expect(noteLines()).toEqual(['No note']);
});

test("on a served page Take turns a note's recommendation into a change draft on its part or edge, focused and editable, hidden while the draft holds text but not while it's blank, and an untaken one sends nothing", async () => {
  const user = userEvent.setup();
  const sent = vi.fn(async () => {});
  render(
    <ReviewPage
      review={pageWith({ ...review })}
      notes={{
        version: 2,
        tests: '',
        summary: [],
        notes: {
          'part rust/crate/application': {
            text: 'Adds the export use case.',
            recommendation: 'Name the export format.',
          },
          'part rust/crate/cli-adapter': { text: 'A second way in.', recommendation: 'Drop it.' },
          'edge rust/crate/cli-adapter -> rust/crate/application': {
            text: 'The CLI drives the use case.',
            recommendation: 'Keep the CLI out of the domain.',
          },
        },
      }}
      send={sent}
    />,
  );
  const field = () => within(inspector()).getByRole('textbox', { name: 'Your comment' });

  await user.click(await screen.findByRole('button', { name: 'application: modified' }));
  await user.click(within(inspector()).getByRole('button', { name: 'Take' }));
  expect(document.activeElement).toBe(field());
  expect(field()).toHaveProperty('value', 'Name the export format.');
  expect(commentKind('Change this')).toHaveProperty('checked', true);
  expect(within(tray()).getByText('1 drafted · 1 change')).toBeDefined();
  expect(take()).toBeNull();

  await user.clear(field());
  await user.type(field(), '  ');
  expect(take()).not.toBeNull();
  await user.click(within(inspector()).getByRole('button', { name: 'Take' }));
  await user.type(field(), ' In the use case.');
  expect(noteLines()).toContain('Recommendation Name the export format.');

  await user.click(screen.getByRole('button', { name: 'cli-adapter → application: added' }));
  await user.click(within(inspector()).getByRole('button', { name: 'Take' }));
  expect(document.activeElement).toBe(field());
  expect(field()).toHaveProperty('value', 'Keep the CLI out of the domain.');
  expect(commentKind('Change this')).toHaveProperty('checked', true);

  await openReview(user);
  await user.click(screen.getByRole('button', { name: 'Send to Claude' }));
  expect(sent).toHaveBeenCalledExactlyOnceWith(
    sentReview({
      verdict: 'request-changes',
      comments: [
        {
          anchor: { kind: 'part', id: 'rust/crate/application' },
          kind: 'change',
          text: 'Name the export format. In the use case.',
        },
        {
          anchor: { kind: 'edge', id: 'rust/crate/cli-adapter -> rust/crate/application' },
          kind: 'change',
          text: 'Keep the CLI out of the domain.',
        },
      ],
    }),
  );
});

test("Take on a part the last review commented on fills that comment's Reply, open and focused", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        sinceReview: { ...sinceReview, comments: [saidOnPart('rust/crate/application')] },
      })}
      notes={{
        version: 2,
        tests: '',
        summary: [],
        notes: {
          'part rust/crate/application': {
            text: 'Adds the export use case.',
            recommendation: 'Name the export format.',
          },
        },
      }}
      send={async () => {}}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'application: modified' }));
  await user.click(within(inspector()).getByRole('button', { name: 'Take' }));
  const underAnchor = within(within(inspector()).getByRole('note', { name: /^Last review/ }));
  expect(underAnchor.getByRole('button', { name: 'Reply' }).getAttribute('aria-expanded')).toBe(
    'true',
  );
  const field = underAnchor.getByRole('textbox', { name: 'Your comment' });
  expect(document.activeElement).toBe(field);
  expect(field).toHaveProperty('value', 'Name the export format.');
  expect(commentKind('Change this')).toHaveProperty('checked', true);
  expect(take()).toBeNull();
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
        version: 2,
        tests: '',
        summary: [],
        notes: {
          'part rust/crate/cli-adapter': { text: 'A second way in.', flag: 'new entry point' },
          'edge rust/crate/cli-adapter -> rust/crate/application': {
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
  const whyLook = () => within(inspector()).queryByRole('region', { name: 'Why look' });
  expect(within(whyLook() ?? inspector()).getAllByRole('listitem')).toHaveLength(2);
  expect(
    within(inspector())
      .getByText('A second way in.')
      .compareDocumentPosition(whyLook() ?? inspector()) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();

  await user.click(screen.getByRole('button', { name: 'domain: unchanged' }));
  expect(findingsShown()).toEqual(['lines 900, over 800']);
  await user.click(screen.getByRole('button', { name: 'application: modified' }));
  expect(whyLook()).toBeNull();

  const shape = async () => (await lenses(user)).getByRole('button', { name: /Shape/ });
  await user.click(await shape());
  expect(screen.getAllByRole('img', { name: /finding/ }).map(badge => badge.ariaLabel)).toEqual([
    'needs a look, 1 finding: new dependency direction',
    'for information, 1 finding: lines 900, over 800, outside Shape',
    'needs a look, 2 findings: cyclomatic 4 → 14, over 10; new entry point',
  ]);
  await user.click(await shape());
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
        version: 2,
        tests: '',
        summary: [
          { text: 'The CLI is a new adapter.', target: 'rust/crate/cli-adapter' },
          { text: 'Domain is untouched.' },
        ],
        notes: {
          'part rust/crate/cli-adapter': { text: 'A second way in.' },
          'edge rust/crate/cli-adapter -> rust/crate/application': {
            text: 'The CLI drives the use case.',
            flag: 'new dependency direction',
          },
          'part rust/crate/legacy': {
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
      notes={{ version: 2, tests: '', summary: [], notes: {} }}
    />,
  );
  expect(screen.queryByRole('region', { name: 'Summary' })).toBeNull();
});

test("the findings rail starts collapsed to their total and how many need a look or are for information, notes' flags among them; opened, it groups them by dimension, each line its title, with its detail if any, and its target, else its detail, and hides again; five lens chips count their dimensions' findings by level, and one picked filters the rail until clicked again", async () => {
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
        version: 2,
        tests: '',
        summary: [],
        notes: {
          'part rust/crate/cli-adapter': { text: 'A second way in.', flag: 'new entry point' },
          'part rust/crate/domain': { text: 'Untouched.' },
          'edge rust/crate/cli-adapter -> rust/crate/application': {
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

  await openInformation(user);
  expect(lensChips()).toEqual([
    'Behaviour · logic, tests checked, nothing found false',
    'Contract ○1 false',
    'Risk · dependencies checked, nothing found false',
    'Shape ○1 ▲2 false',
    'Context ○1 ▲1 false',
  ]);
  const headings = () =>
    within(screen.getByRole('complementary', { name: 'Findings' }))
      .getAllByRole('heading', { level: 3 })
      .map(heading => heading.textContent);
  const context = async () => (await lenses(user)).getByRole('button', { name: /Context/ });
  await user.click(await context());
  expect(lensChips()).toContain('Context ○1 ▲1 true');
  expect(headings()).toEqual(['Metrics']);
  await user.click(await context());
  expect(lensChips()).toContain('Context ○1 ▲1 false');
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
  expect(lensChips()).toContain('Context ○1 false');

  rerender(<ReviewPage review={pageWith({ ...review, findings: [] })} />);
  expect(within(rail()).getByRole('button', { name: 'Show 0 findings' })).toBeDefined();
  expect(lensChips()).toEqual([
    'Behaviour · logic, tests checked, nothing found false',
    'Contract · api, schema, routes, blast radius checked, nothing found false',
    'Risk · dependencies checked, nothing found false',
    'Shape · structure, cohesion checked, nothing found false',
    'Context · metrics checked, nothing found false',
  ]);
});

test("a lens counts each of its dimensions' findings, a note's flag among them, and picking it leaves only those in Start here and the rail", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        findings: [
          findingOn('rust/crate/domain', { id: 'one', check: 'logic:changed', dimension: 'logic' }),
          findingOn('rust/crate/application', {
            id: 'two',
            check: 'logic:changed',
            dimension: 'logic',
          }),
          findingOn('rust/crate/application', {
            id: 'three',
            check: 'tests:untested-logic',
            dimension: 'tests',
            level: 'look',
            title: 'no test alongside',
          }),
          findingOn('rust/crate/cli-adapter', { id: 'outside' }),
        ],
      })}
      notes={{
        version: 2,
        tests: '',
        summary: [],
        notes: {
          'part rust/crate/cli-adapter': {
            text: 'Reads a token.',
            flag: 'reads a token',
            dimension: 'security',
          },
        },
      }}
    />,
  );

  const startHereLines = within(await screen.findByRole('region', { name: 'Start here' }));
  expect(startHereLines.getByRole('button', { name: /reads a token/ })).toBeDefined();
  await openInformation(user);
  expect(lensChips()).toEqual([
    'Behaviour ○2 ▲1 false',
    'Contract · api, schema, routes, blast radius checked, nothing found false',
    'Risk ▲1 false',
    'Shape · structure, cohesion checked, nothing found false',
    'Context ○1 false',
  ]);

  await user.click(
    (await lenses(user)).getByRole('button', {
      name: /Behaviour/,
    }),
  );
  expect(startHereLines.queryByRole('button', { name: /reads a token/ })).toBeNull();
  expect(startHereLines.getByRole('button', { name: /no test alongside/ })).toBeDefined();
  expect(startHereLines.getByRole('button', { name: /^2 functions/ })).toBeDefined();
  await user.click(screen.getByRole('button', { name: 'All findings' }));
  const open = screen.getByRole('complementary', { name: 'Findings' });
  expect(
    within(open)
      .getAllByRole('heading', { level: 3 })
      .map(heading => heading.textContent),
  ).toEqual(['Logic', 'Tests']);
  expect(await screen.findByRole('button', { name: 'domain: unchanged' })).toBeDefined();
});

test("a picked lens lists its dimensions under the chips, each with its counts, 'checked, none' or why it wasn't read, a part-read one with both, and a dimension no check raises only when a finding is in it", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        findings: [
          findingOn('rust/crate/domain', { id: 'a', check: 'logic:changed', dimension: 'logic' }),
          findingOn('rust/crate/domain', {
            id: 'b',
            check: 'logic:removed',
            dimension: 'logic',
            level: 'look',
          }),
          findingOn('rust/crate/domain', { id: 'c', check: 'api:signature', dimension: 'api' }),
          findingOn('rust/crate/domain', {
            id: 'd',
            check: 'flag',
            dimension: 'security',
            level: 'look',
          }),
        ],
        coverage: [
          { dimension: 'structure', notRead: ['crates not read'] },
          { dimension: 'logic', notRead: ['not read for crates'] },
          { dimension: 'api', notRead: [] },
          { dimension: 'tests', notRead: ['not read for crates', 'not read for web/a.test.ts'] },
          { dimension: 'metrics', notRead: [] },
          { dimension: 'dependencies', notRead: [] },
          { dimension: 'schema', notRead: ['Rails only'] },
          { dimension: 'routes', notRead: [] },
          { dimension: 'cohesion', notRead: [] },
        ],
      })}
    />,
  );

  await openInformation(user);
  const lenses = within(await screen.findByRole('group', { name: 'Lenses' }));
  expect(lensChips()).toEqual([
    'Behaviour ○1 ▲1 false',
    'Contract ○1 false',
    'Risk ▲1 false',
    'Shape false',
    'Context · metrics checked, nothing found false',
  ]);
  expect(screen.queryByRole('list', { name: /dimensions/ })).toBeNull();

  await user.click(lenses.getByRole('button', { name: /Behaviour/ }));
  expect(lensRow('Behaviour')).toEqual([
    'Logic· not read for crates ○1 ▲1',
    'Testsnot read for crates · not read for web/a.test.ts',
  ]);

  await user.click(lenses.getByRole('button', { name: /Contract/ }));
  expect(lensRow('Contract')).toEqual(['API ○1', 'SchemaRails only', 'Routeschecked, none']);

  await user.click(lenses.getByRole('button', { name: /Risk/ }));
  expect(lensRow('Risk')).toEqual(['Dependencieschecked, none', 'Security ▲1']);

  await user.click(lenses.getByRole('button', { name: /Risk/ }));
  expect(screen.queryByRole('list', { name: /dimensions/ })).toBeNull();
});

test("a note's or a metric finding in the rail goes to its node or edge as the summary's links do, its row in view under Why look, the graph keeping the focus", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        findings: [findingOn('rust/crate/domain')],
      })}
      notes={{
        version: 2,
        tests: '',
        summary: [],
        notes: {
          'part rust/crate/application': { text: 'Adds the export use case.', flag: 'exports' },
          'edge rust/crate/cli-adapter -> rust/crate/application': {
            text: 'The CLI drives the use case.',
            flag: 'new dependency direction',
          },
        },
      }}
    />,
  );
  const landedUnderWhyLook = () =>
    within(within(inspector()).getByRole('region', { name: 'Why look' })).getByRole('listitem', {
      current: true,
    });

  await user.click(await screen.findByRole('button', { name: 'Show 3 findings' }));
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
  expect(scrolledIntoView.mock.contexts).toContain(landedUnderWhyLook());

  await user.click(rail().getByRole('button', { name: /^application: exports/ }));
  expect(scrolledIntoView.mock.contexts).toContain(landedUnderWhyLook());

  await user.click(rail().getByRole('button', { name: 'domain: lines 900, over 800' }));
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'domain: unchanged' }));
  expect(scrolledIntoView.mock.contexts).toContain(landedUnderWhyLook());
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
          findingOn('rust/crate/cli-adapter', {
            id: 'notes:part rust/crate/cli-adapter',
            level: 'look',
          }),
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
  expect(rowsOf(order)).toEqual([
    '1 application',
    '2 cli-adapter',
    '3 legacy',
    '4 README.md',
    '5 docs/a.md',
  ]);
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
  expect(within(order).getAllByText(/import each other/)).toEqual([
    within(first ?? order).getByText("These 3 import each other, so they're read alphabetically"),
  ]);
  await user.click(within(order).getByRole('button', { name: '2 cli-adapter' }));
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
  expect(rowsOf(order)).toEqual(['1 application']);
  expect(within(order).queryByRole('heading', { name: 'Outside the graph' })).toBeNull();

  rerender(
    <ReviewPage review={pageWith({ ...review, undrawn: [{ path: 'README.md', patch: '' }] })} />,
  );
  expect(rowsOf(screen.getByRole('navigation', { name: 'Reading order' }))).toEqual([
    '1 README.md',
  ]);

  rerender(<ReviewPage review={pageWith(review)} />);
  expect(screen.queryByRole('navigation', { name: 'Reading order' })).toBeNull();
});

test('the parts read are counted and barred on every tab, only when there are parts, a single part in the singular, and no longer in the reading order', async () => {
  const user = userEvent.setup();
  const { rerender } = render(
    <ReviewPage review={pageWith({ ...review, undrawn: [{ path: 'README.md', patch: '' }] })} />,
  );
  await screen.findByRole('group', { name: 'rust' });
  expect(screen.queryByText(/parts? read$/)).toBeNull();
  expect(screen.queryByRole('progressbar')).toBeNull();

  rerender(
    <ReviewPage
      review={pageWith({
        ...review,
        readingOrder: { parts: ['rust/crate/application'], cycles: [] },
      })}
    />,
  );
  expect(screen.getByText('0 of 1 part read')).toBeDefined();
  expect(within(readingOrder()).queryByText('0 of 1 part read')).toBeNull();

  rerender(<ReviewPage review={walkedReview()} />);
  await user.keyboard('ja');
  const bar = () => screen.getByRole<HTMLProgressElement>('progressbar', { name: 'Parts read' });
  expect(screen.getByText('1 of 3 parts read')).toBeDefined();
  expect([bar().value, bar().max]).toEqual([1, 3]);

  await user.click(screen.getByRole('link', { name: /^Tests/ }));
  expect(screen.getByText('1 of 3 parts read')).toBeDefined();
  expect(bar().value).toBe(1);
});

test("from the landing, J goes to the first part unread, the graph becomes the map, and focus moves to the part's heading", async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={walkedReview()} />);
  const rust = await screen.findByRole('group', { name: 'rust' });
  await user.click(within(rust).getByRole('button', { name: 'application: modified' }));
  await user.keyboard('a');
  await user.click(screen.getByRole('button', { name: 'Close inspector' }));
  expect(screen.getByRole('group', { name: 'Graph' })).toBeDefined();
  expect(screen.queryByRole('group', { name: 'Map' })).toBeNull();

  await user.keyboard('j');

  expect(selectedPart()).toBe('cli-adapter');
  expect(screen.getByRole('group', { name: 'Map' })).toBeDefined();
  expect(screen.queryByRole('group', { name: 'Graph' })).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(headingOfPart()));
});

test('while reading, the landing gives way: no lenses, Start here or findings rail, and the column comes before the map', async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={{ ...walkedReview(), findings: [findingOn('rust/crate/domain')] }} />);
  await screen.findByRole('group', { name: 'rust' });
  const landing = () => [
    screen.queryByRole('group', { name: 'Lenses' }),
    screen.queryByRole('region', { name: 'Start here' }),
    screen.queryByRole('navigation', { name: 'Findings' }),
  ];
  await openInformation(user);
  await user.click(screen.getByRole('button', { name: 'domain: unchanged' }));
  expect(screen.getByRole('group', { name: 'Graph' })).toBeDefined();
  expect(landing().every(piece => piece !== null)).toBe(true);
  expect(screen.getByRole('separator', { name: 'Panel width' })).toBeDefined();
  expect(inspector().style.width).toBe('360px');

  await user.keyboard('j');

  expect(landing()).toEqual([null, null, null]);
  expect(screen.queryByRole('separator', { name: 'Panel width' })).toBeNull();
  expect(inspector().style.width).toBe('');
  const map = screen.getByRole('group', { name: 'Map' });
  expect(inspector().compareDocumentPosition(map)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
});

test("Open map and Escape outside a field return to the landing with the part still selected and focused in the graph; the column's close returns with nothing selected", async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={walkedReview()} send={vi.fn()} />);
  await screen.findByRole('group', { name: 'rust' });
  const nodeOfPart = () => screen.getByRole('button', { name: 'application: modified' });

  await user.keyboard('j');
  await user.click(screen.getByRole('button', { name: 'Open map' }));
  expect(screen.getByRole('group', { name: 'Graph' })).toBeDefined();
  expect(screen.queryByRole('button', { name: 'Open map' })).toBeNull();
  expect(selectedPart()).toBe('application');
  await waitFor(() => expect(document.activeElement).toBe(nodeOfPart()));

  await user.keyboard('j');
  expect(selectedPart()).toBe('cli-adapter');
  const box = await partComment(user);
  await user.click(box);
  await user.keyboard('{Escape}');
  expect(screen.getByRole('group', { name: 'Map' })).toBeDefined();
  await user.click(headingOfPart());
  await user.keyboard('{Control>}{Escape}{/Control}');
  expect(screen.getByRole('group', { name: 'Map' })).toBeDefined();
  await user.keyboard('{Escape}');
  expect(screen.getByRole('group', { name: 'Graph' })).toBeDefined();
  expect(selectedPart()).toBe('cli-adapter');
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'cli-adapter: added' })),
  );
  await user.click(headingOfPart());
  await user.keyboard('{Escape}');
  expect(document.activeElement).toBe(headingOfPart());

  await user.keyboard('j');
  scrolledIntoView.mockClear();
  await user.click(screen.getByRole('button', { name: 'Close inspector' }));
  const graph = screen.getByRole('group', { name: 'Graph' });
  expect(screen.queryByRole('complementary', { name: 'Inspector' })).toBeNull();
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^legacy:/ })),
  );
  expect(scrolledIntoView.mock.contexts).toContain(graph);
});

test('the map draws the part centred in its neighbourhood and takes no zoom or pan, and Open map brings back the graph on the part', async () => {
  const user = userEvent.setup();
  const graph = await layoutDiff(review.diff);
  const width = graph.width / 2;
  renderInFrame(walkedReview(), { width, windowHeight: 100 });
  const rust = await screen.findByRole('group', { name: 'rust' });
  const box = boxOf({ layout: graph, id: 'rust/crate/application' });
  if (box === undefined) throw new Error('no box for application');
  const onThePart = centred({
    graph,
    frame: { width, height: frameHeight({ graph, frameWidth: width, windowHeight: 100 }) },
    box,
  });
  const whole = viewOf(rust);

  await user.click(within(rust).getByRole('button', { name: 'domain: unchanged' }));
  expect(screen.getByRole('group', { name: 'Graph' })).toBeDefined();
  expect(viewOf(rust)).toBe(whole);

  await user.keyboard('j');

  const map = screen.getByRole('group', { name: 'Map' });
  const around = aroundPart({
    graph,
    frame: { width, height: mapHeight({ graph, frameWidth: width }) },
    box,
  });
  const fittedView = `translate(${around.x} ${around.y}) scale(${around.scale})`;
  expect(viewOf(rust)).toBe(fittedView);
  expect(map.style.height).toBe(`${mapHeight({ graph, frameWidth: width })}px`);
  expect(map.tabIndex).toBe(-1);
  expect(screen.queryByRole('toolbar', { name: 'View' })).toBeNull();

  fireEvent.keyDown(map, { key: '+' });
  expect(fireEvent.keyDown(map, { key: 'ArrowLeft' })).toBe(true);
  expect(fireEvent.wheel(map, { ctrlKey: true, deltaY: -100 })).toBe(true);
  expect(fireEvent.wheel(map, { deltaY: 40 })).toBe(true);
  fireEvent.pointerDown(map, { button: 0, clientX: 100, clientY: 100 });
  fireEvent.pointerMove(window, { clientX: 60, clientY: 60 });
  fireEvent.pointerUp(window);
  expect(viewOf(rust)).toBe(fittedView);
  expect(selectedPart()).toBe('application');

  await user.click(screen.getByRole('button', { name: 'Open map' }));
  expect(viewOf(rust)).toBe(`translate(${onThePart.x} ${onThePart.y}) scale(${onThePart.scale})`);
});

test('on the map the current part is marked, a click on a node goes to it as J does, and nothing on it takes a tab stop', async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={walkedReview()} />);
  const rust = await screen.findByRole('group', { name: 'rust' });
  const node = (name: string) => within(rust).getByRole('button', { name });
  const application = () => node('application: modified');
  const legacy = () => node('legacy: removed');
  await user.click(application());
  expect(application().getAttribute('aria-current')).toBeNull();
  expect(application().tabIndex).toBe(0);

  await user.keyboard('j');
  expect(selectedPart()).toBe('cli-adapter');
  expect(node('cli-adapter: added').getAttribute('aria-current')).toBe('true');
  expect(application().getAttribute('aria-current')).toBeNull();
  expect(application().tabIndex).toBe(-1);

  await user.click(legacy());
  expect(selectedPart()).toBe('legacy');
  expect(legacy().getAttribute('aria-current')).toBe('true');
  await waitFor(() => expect(document.activeElement).toBe(headingOfPart()));
  expect(screen.getByRole('group', { name: 'Map' })).toBeDefined();
});

test('on the map no box takes a toggle, and a part whose box stands open is marked as a closed one is', async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        range: `walk-${crypto.randomUUID()}`,
        diff: {
          nodes: [
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
            webModule('utils', 'modified'),
            webFile('utils', 'y.ts'),
          ],
          edges: [],
        },
        readingOrder: { parts: ['web/module/utils'], cycles: [] },
      })}
    />,
  );
  await screen.findByRole('group', { name: 'web' });
  await showEverything(user);
  await user.click(await screen.findByRole('button', { name: 'Expand utils' }));
  const box = await screen.findByRole('group', { name: 'utils' });
  expect(box.getAttribute('aria-current')).toBeNull();
  expect(screen.getByRole('button', { name: 'Collapse utils' })).toBeDefined();

  await user.keyboard('j');

  expect(selectedPart()).toBe('utils');
  expect(screen.getByRole('group', { name: 'utils' }).getAttribute('aria-current')).toBe('true');
  expect(screen.queryByRole('button', { name: 'Collapse utils' })).toBeNull();
});

test('while reading, going to a draft on a diff line keeps the column on its row, where a walk lets the heading bring the window to it', async () => {
  const user = userEvent.setup();
  const page = pageWithPatch('@@ -1 +1 @@', '-const x = 1;', '+const x = 2;');
  render(
    <ReviewPage
      review={{ ...page, readingOrder: { parts: ['web/file/x.ts'], cycles: [] } }}
      send={vi.fn(async () => {})}
    />,
  );
  const name = 'x.ts:1 "const x = 1;"';
  await screen.findByRole('button', { name: 'x.ts: modified' });
  const focused = vi.spyOn(HTMLElement.prototype, 'focus');
  onTestFinished(() => focused.mockRestore());

  await user.keyboard('j');
  await waitFor(() => expect(document.activeElement).toBe(headingOfPart()));
  expect(focused.mock.lastCall).toEqual([{ preventScroll: false }]);

  await openFold(user, 'Full diff');
  await user.click(within(diffTab()).getByRole('button', { name: `Comment on ${name}` }));
  await write(user, within(diffTab()).getByRole('textbox', { name: 'Your comment' }), 'Why?');
  await openReview(user);
  await user.click(
    within(screen.getByRole('list', { name: 'Drafts' })).getByRole('button', { name }),
  );

  await waitFor(() => expect(document.activeElement).toBe(headingOfPart()));
  expect(focused.mock.lastCall).toEqual([{ preventScroll: true }]);
});

test('walking brings the current stop into view in its list, and marking it read leaves the list where it is', async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={walkedReview()} />);
  await screen.findByRole('group', { name: 'rust' });
  const currentStop = () =>
    within(readingOrder())
      .getAllByRole('button')
      .find(button => button.getAttribute('aria-current') !== null);

  await user.keyboard('j');
  expect(scrolledIntoView.mock.contexts).toContain(currentStop());

  const first = currentStop();
  scrolledIntoView.mockClear();
  await user.keyboard('j');
  expect(currentStop()).not.toBe(first);
  expect(scrolledIntoView.mock.contexts).toContain(currentStop());
  expect(scrolledIntoView.mock.contexts).not.toContain(first);

  const second = currentStop();
  scrolledIntoView.mockClear();
  await user.keyboard('a');
  expect(scrolledIntoView.mock.contexts).not.toContain(second);
});

test('walking leaves the page where it stands, wherever the current stop sits on screen', async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={walkedReview()} />);
  await screen.findByRole('group', { name: 'rust' });
  const everything = vi.spyOn(Element.prototype, 'getBoundingClientRect');
  onTestFinished(() => everything.mockRestore());
  everything.mockReturnValue(at(-120, -20));
  scrolledBy.mockClear();

  await user.keyboard('j');

  expect(within(readingOrder()).getByRole('button', { current: 'step' })).toBeDefined();
  expect(scrolledBy).not.toHaveBeenCalled();
});

test('on a map fitted too small to see a part, the ring around the current one stays big enough to find', async () => {
  const user = userEvent.setup();
  renderInFrame(walkedReview(), { width: 20, windowHeight: 800 });
  await screen.findByRole('group', { name: 'rust' });

  await user.keyboard('j');

  await waitFor(() => expect(document.querySelector('.current-ring')).not.toBeNull());
  const ring = document.querySelector('.current-ring');
  const widthOf = (element: Element | null | undefined) => Number(element?.getAttribute('width'));
  expect(widthOf(ring)).toBeGreaterThan(widthOf(ring?.previousElementSibling));
});

test('a row of the reading order and Start reading enter reading, Start reading as J goes; a click in the graph and a finding keep the graph whole', async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={{ ...walkedReview(), findings: [findingOn('rust/crate/domain')] }} />);
  await screen.findByRole('group', { name: 'rust' });
  const row = (part: string) =>
    within(readingOrder()).getByRole('button', { name: new RegExp(part) });
  const inGraph = () => screen.getByRole('group', { name: 'Graph' });
  const onMap = () => screen.getByRole('group', { name: 'Map' });

  await user.click(screen.getByRole('button', { name: 'domain: unchanged' }));
  expect(inGraph()).toBeDefined();
  await user.click(screen.getByRole('button', { name: 'Show 1 finding' }));
  await user.click(
    within(screen.getByRole('complementary', { name: 'Findings' })).getByRole('button', {
      name: 'domain: lines 900, over 800',
    }),
  );
  expect(inGraph()).toBeDefined();

  await user.click(row('legacy'));
  expect(selectedPart()).toBe('legacy');
  expect(onMap()).toBeDefined();
  await waitFor(() => expect(document.activeElement).toBe(headingOfPart()));

  await user.click(screen.getByRole('button', { name: 'Open map' }));
  await user.click(screen.getByRole('button', { name: 'Close inspector' }));
  await user.click(within(readingOrder()).getByRole('button', { name: 'Start reading' }));
  expect(selectedPart()).toBe('application');
  expect(onMap()).toBeDefined();
});

test('while reading, the reading order narrows to numbered stops: the part current, a tick on what is read, each going to its part, and outside files opening their panel', async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage review={{ ...walkedReview(), undrawn: [{ path: 'README.md', patch: '' }] }} />,
  );
  await screen.findByRole('group', { name: 'rust' });
  const stop = (name: string) => within(readingOrder()).getByRole('button', { name });
  const currentStops = () =>
    within(readingOrder())
      .getAllByRole('button')
      .filter(button => button.getAttribute('aria-current') !== null)
      .map(button => [button.textContent, button.getAttribute('aria-current')]);
  const startReading = () =>
    within(readingOrder()).queryByRole('button', { name: 'Start reading' });
  const outsideHeading = () => within(readingOrder()).queryByText('Outside the graph');
  expect(startReading()).not.toBeNull();
  expect(outsideHeading()).not.toBeNull();
  expect(currentStops()).toEqual([]);

  await user.keyboard('j');

  expect(startReading()).toBeNull();
  expect(outsideHeading()).toBeNull();
  expect(rowsOf(readingOrder())).toEqual([
    '1 application',
    '2 cli-adapter',
    '3 legacy',
    '4 README.md',
  ]);
  expect(stop('2 cli-adapter').title).toBe('cli-adapter');
  expect(currentStops()).toEqual([['1 application', 'step']]);

  await user.keyboard('a');
  expect(readRows()).toEqual(['1 application']);

  await user.click(stop('3 legacy'));
  expect(selectedPart()).toBe('legacy');
  expect(currentStops()).toEqual([['3 legacy', 'step']]);
  expect(screen.getByRole('group', { name: 'Map' })).toBeDefined();

  await user.click(stop('4 README.md'));
  expect(selectedPart()).toBe('Changed files outside the graph');
  expect(currentStops()).toEqual([]);
  expect(screen.getByRole('group', { name: 'Map' })).toBeDefined();
});

test("while reading, Next to it lists the part's edges by what each does, its change and whether the other end is read, each going to it; a linker's edge calls, and the landing has none", async () => {
  const user = userEvent.setup();
  const { unmount } = render(
    <ReviewPage
      review={{
        ...walkedReview(),
        diff: {
          ...review.diff,
          edges: [
            ...review.diff.edges,
            { ...dependency('application', 'legacy', 'unchanged'), via: ['/api/x'] },
            { ...dependency('domain', 'application', 'unchanged'), via: ['/api/y'] },
          ],
        },
      }}
    />,
  );
  const rust = await screen.findByRole('group', { name: 'rust' });
  const nextToIt = () => screen.queryByRole('region', { name: 'Next to it' });
  const rows = () =>
    within(nextToIt() ?? document.body)
      .getAllByRole('button')
      .map(row => row.textContent);
  await user.click(within(rust).getByRole('button', { name: 'application: modified' }));
  expect(nextToIt()).toBeNull();

  await user.keyboard('jak');

  expect(selectedPart()).toBe('application');
  expect(rows()).toEqual([
    'calls legacy',
    'imported by cli-adapter · added · read',
    'imports domain',
    'called by domain',
  ]);
  expect(within(nextToIt() ?? document.body).getByText('and 2 unchanged')).toBeDefined();

  await user.click(screen.getByRole('button', { name: 'imports domain' }));
  expect(selectedPart()).toBe('domain');
  expect(screen.getByRole('group', { name: 'Map' })).toBeDefined();
  unmount();

  render(<ReviewPage review={{ ...walkedReview(), diff: { ...review.diff, edges: [] } }} />);
  await screen.findByRole('group', { name: 'rust' });
  await user.keyboard('j');
  expect(selectedPart()).toBe('application');
  expect(nextToIt()).toBeNull();
});

test('All findings, while reading, returns to the landing with every finding open in the rail whatever lens was picked, and is there only with findings', async () => {
  const user = userEvent.setup();
  const { unmount } = render(<ReviewPage review={walkedReview()} />);
  await screen.findByRole('group', { name: 'rust' });
  await user.keyboard('j');
  expect(screen.getByRole('group', { name: 'Map' })).toBeDefined();
  expect(screen.queryByRole('button', { name: 'All findings' })).toBeNull();
  unmount();

  render(<ReviewPage review={{ ...walkedReview(), findings: [findingOn('rust/crate/domain')] }} />);
  await screen.findByRole('group', { name: 'rust' });
  await user.click((await lenses(user)).getByRole('button', { name: /Risk/ }));
  await user.keyboard('j');
  await user.click(screen.getByRole('button', { name: 'All findings' }));

  expect(screen.getByRole('group', { name: 'Graph' })).toBeDefined();
  expect(
    within(screen.getByRole('complementary', { name: 'Findings' })).getByRole('button', {
      name: 'domain: lines 900, over 800',
    }),
  ).toBeDefined();
});

test('reading holds across Tests: the map, the part and the column are as they were left', async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={walkedReview()} />);
  await screen.findByRole('group', { name: 'rust' });
  await user.keyboard('jj');
  expect(selectedPart()).toBe('cli-adapter');

  await user.click(screen.getByRole('link', { name: /^Tests/ }));
  expect(screen.queryByRole('group', { name: 'Map' })).toBeNull();
  await user.click(screen.getByRole('link', { name: 'Structure' }));

  expect(await screen.findByRole('group', { name: 'Map' })).toBeDefined();
  expect(selectedPart()).toBe('cli-adapter');
  expect(rowsOf(readingOrder())).toHaveLength(3);
});

test('on the map an arrow and its badge go nowhere: the part stays, and they go again on the landing', async () => {
  const user = userEvent.setup();
  const edge = 'rust/crate/cli-adapter -> rust/crate/application';
  render(
    <ReviewPage
      review={walkedReview()}
      notes={{
        version: 2,
        tests: '',
        summary: [],
        notes: {
          [`edge ${edge}`]: { text: 'The CLI drives the use case.', flag: 'new direction' },
        },
      }}
    />,
  );
  await screen.findByRole('group', { name: 'rust' });
  const arrowName = 'cli-adapter → application: added, flagged: new direction';
  const arrow = screen.getByRole('button', { name: arrowName });
  const badge = screen.getByRole('img', { name: /new direction/ });

  await user.keyboard('j');
  expect(selectedPart()).toBe('application');
  expect(screen.queryByRole('button', { name: arrowName })).toBeNull();
  await user.click(arrow);
  expect(selectedPart()).toBe('application');
  await user.click(badge);
  expect(selectedPart()).toBe('application');

  await user.click(screen.getByRole('button', { name: 'Open map' }));
  await user.click(screen.getByRole('button', { name: arrowName }));
  expect(noteShown()).toBe('The CLI drives the use case.');
});

test("Start here's lists stay as they were left after reading", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={{ ...walkedReview(), findings: [findingOn('rust/crate/domain', { level: 'look' })] }}
    />,
  );
  await screen.findByRole('group', { name: 'rust' });
  const toggle = () =>
    within(screen.getByRole('region', { name: 'Start here' })).getByRole('button', {
      name: '1 to look at',
    });
  expect(toggle().getAttribute('aria-expanded')).toBe('true');
  await user.click(toggle());
  expect(toggle().getAttribute('aria-expanded')).toBe('false');

  await user.keyboard('j');
  await user.keyboard('{Escape}');

  expect(toggle().getAttribute('aria-expanded')).toBe('false');
});

test("going to a part from another tab while reading lands focus on the part's heading", async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={walkedReview()} />);
  await screen.findByRole('group', { name: 'rust' });
  await user.keyboard('j');

  await user.click(screen.getByRole('link', { name: 'Tests' }));
  await user.click(await screen.findByRole('button', { name: 'cli-adapter' }));

  expect(await screen.findByRole('group', { name: 'Map' })).toBeDefined();
  expect(selectedPart()).toBe('cli-adapter');
  await waitFor(() => expect(document.activeElement).toBe(headingOfPart()));
});

test('going from Next to it to a neighbour Show hides widens Show, and the map rings it', async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={{
        ...walkedReview(),
        diff: { ...review.diff, edges: [dependency('application', 'domain', 'unchanged')] },
      }}
    />,
  );
  await screen.findByRole('group', { name: 'rust' });
  await user.keyboard('j');
  const map = () => within(screen.getByRole('group', { name: 'Map' }));
  await waitFor(() =>
    expect(map().getByRole('button', { name: 'application: modified' })).toHaveProperty(
      'ariaCurrent',
      'true',
    ),
  );
  expect(map().queryByRole('button', { name: 'domain: unchanged' })).toBeNull();

  await user.click(screen.getByRole('button', { name: 'imports domain' }));

  const domain = await map().findByRole('button', { name: 'domain: unchanged' });
  expect(domain.getAttribute('aria-current')).toBe('true');
});

test('J and K walk the reading order from the selected part, starting at its first part, going to each as its row does, and stay put at either end', async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={walkedReview()} />);
  await screen.findByRole('group', { name: 'rust' });

  await user.keyboard('k');
  expect(selectedPart()).toBe('application');
  await user.keyboard('j');
  expect(selectedPart()).toBe('cli-adapter');
  await waitFor(() => expect(document.activeElement).toBe(headingOfPart()));
  await user.keyboard('jjj');
  expect(selectedPart()).toBe('legacy');
  await user.keyboard('kkk');
  expect(selectedPart()).toBe('application');
});

test('J at the last part selected in the graph enters reading on it, and with every part read goes from the landing to the first', async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={walkedReview()} />);
  const rust = await screen.findByRole('group', { name: 'rust' });

  await user.click(within(rust).getByRole('button', { name: 'legacy: removed' }));
  expect(screen.getByRole('group', { name: 'Graph' })).toBeDefined();
  await user.keyboard('j');
  expect(selectedPart()).toBe('legacy');
  expect(screen.getByRole('group', { name: 'Map' })).toBeDefined();

  await user.keyboard('akakak');
  await user.click(screen.getByRole('button', { name: 'Close inspector' }));
  await user.keyboard('j');
  expect(selectedPart()).toBe('application');
});

test("a part's head marks it read and goes to the next part, as A and J do, even on a page not served; a part outside the reading order takes no mark, the last no Next", async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={walkedReview()} />);
  const rust = await screen.findByRole('group', { name: 'rust' });
  expect(screen.getByText(/next or previous/).textContent).not.toContain('comment');
  const head = () => within(inspector());
  const markRead = () => head().getByRole('button', { name: 'Mark read' });
  const goNext = (part: string) =>
    user.click(head().getByRole('button', { name: `Next: ${part}` }));
  const anyNext = () => head().queryByRole('button', { name: /^Next/ });

  await user.click(within(rust).getByRole('button', { name: 'domain: unchanged' }));
  expect(head().queryByRole('button', { name: 'Mark read' })).toBeNull();

  expect(screen.getByRole('group', { name: 'Graph' })).toBeDefined();
  await goNext('application');
  expect(selectedPart()).toBe('application');
  expect(screen.getByRole('group', { name: 'Map' })).toBeDefined();
  expect(markRead().getAttribute('aria-pressed')).toBe('false');

  await user.click(markRead());
  expect(markRead().getAttribute('aria-pressed')).toBe('true');
  expect(readRows()).toEqual([expect.stringContaining('application')]);
  await user.keyboard('a');
  expect(markRead().getAttribute('aria-pressed')).toBe('false');

  await goNext('cli-adapter');
  expect(selectedPart()).toBe('cli-adapter');
  await waitFor(() => expect(document.activeElement).toBe(headingOfPart()));
  await goNext('legacy');
  expect(selectedPart()).toBe('legacy');
  expect(markRead()).not.toBeNull();
  expect(anyNext()).toBeNull();

  await user.click(screen.getByRole('button', { name: 'Open map' }));
  await user.click(within(rust).getByRole('button', { name: 'application → domain: unchanged' }));
  expect(head().queryByRole('button', { name: 'Mark read' })).toBeNull();
  expect(anyNext()).toBeNull();
});

test('the next part opens at the top of the column, which holds its scroll while the part stays', async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={walkedReview()} />);
  await screen.findByRole('group', { name: 'rust' });

  await user.keyboard('k');
  inspector().scrollTop = 300;
  await user.keyboard('a');
  expect(inspector().scrollTop).toBe(300);
  await user.keyboard('j');
  expect(selectedPart()).toBe('cli-adapter');
  expect(inspector().scrollTop).toBe(0);

  await user.keyboard('{Escape}');
  const rust = screen.getByRole('group', { name: 'rust' });
  await user.click(within(rust).getByRole('button', { name: 'application → domain: unchanged' }));
  inspector().scrollTop = 300;
  await user.click(within(rust).getByRole('button', { name: 'cli-adapter → application: added' }));
  expect(inspector().scrollTop).toBe(0);
});

test('a finding leaves the column to its row, not its top', async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        ...review,
        findings: [findingOn('rust/crate/domain')],
        metrics: {
          'rust/crate/application': { base: measured(), head: measured() },
          'rust/crate/domain': { base: measured(), head: measured() },
        },
      })}
    />,
  );
  const rust = await screen.findByRole('group', { name: 'rust' });
  const goToFinding = () =>
    user.click(
      within(screen.getByRole('complementary', { name: 'Findings' })).getByRole('button', {
        name: 'domain: lines 900, over 800',
      }),
    );
  await user.click(await screen.findByRole('button', { name: 'Show 1 finding' }));

  await user.click(within(rust).getByRole('button', { name: 'application: modified' }));
  inspector().scrollTop = 300;
  await goToFinding();
  expect(selectedPart()).toBe('domain');
  expect(inspector().scrollTop).toBe(300);
});

test('A marks the selected part read, ticking its row and counting it, and A again leaves it unread', async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={walkedReview()} />);
  await screen.findByRole('group', { name: 'rust' });
  expect(screen.getByText('0 of 3 parts read')).toBeDefined();

  await user.keyboard('ja');
  await user.keyboard('jja');
  expect(readRows()).toEqual(['1 application', '3 legacy']);
  expect(screen.getByText('2 of 3 parts read')).toBeDefined();

  await user.keyboard('a');
  expect(readRows()).toEqual(['1 application']);
  expect(screen.getByText('1 of 3 parts read')).toBeDefined();

  await user.click(screen.getByRole('button', { name: 'domain: unchanged' }));
  await user.keyboard('a');
  expect(screen.getByText('1 of 3 parts read')).toBeDefined();
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
  expect(screen.getByText('1 of 3 parts read')).toBeDefined();
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

  expect(screen.getByText('1 of 3 parts read')).toBeDefined();
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
  await write(user, await partComment(user), 'Is this adapter tested?');
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
  await write(user, await partComment(user), 'Why?');
  await user.click(within(rust).getByRole('button', { name: 'legacy: removed' }));
  await write(user, await partComment(user), ' ');
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
  await user.keyboard('ja{Escape}');
  await user.click(within(rust).getByRole('button', { name: 'application → domain: unchanged' }));
  await write(user, await partComment(user), 'Why?');
  await user.click(within(rust).getByRole('button', { name: 'legacy: removed' }));
  await pickKind(user, 'Change this');
  await write(user, await partComment(user), 'Keep it.');
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
  expect(screen.getByText('0 of 4 parts read')).toBeDefined();
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

test('J, K and A act on Structure alone: on Tests they neither walk nor mark', async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={walkedReview()} />);
  await screen.findByRole('group', { name: 'rust' });
  await user.keyboard('j');

  await user.click(screen.getByRole('link', { name: /^Tests/ }));
  await waitFor(() => expect(currentTab()).toMatch(/^Tests/));
  await user.keyboard('ja');
  await user.click(screen.getByRole('link', { name: 'Structure' }));
  await screen.findByRole('group', { name: 'rust' });

  expect(selectedPart()).toBe('application');
  expect(screen.getByText('0 of 3 parts read')).toBeDefined();
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
  expect(screen.getByText('0 of 3 parts read')).toBeDefined();
});

test("C opens and focuses the selected part's comment, or refocuses it, not in a textarea or with a modifier, and going away and back leaves focus alone; a click on the opener focuses too", async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={walkedReview()} send={async () => {}} />);
  const rust = await screen.findByRole('group', { name: 'rust' });
  const field = () => within(inspector()).queryByRole('textbox', { name: 'Your comment' });
  const opener = (part: string) =>
    within(inspector()).getByRole('button', { name: `Comment on ${part}` });
  expect(screen.getByText(/next or previous/).textContent).toContain('C comment');

  await user.click(within(rust).getByRole('button', { name: 'domain: unchanged' }));
  await user.click(opener('domain'));
  expect(document.activeElement).toBe(field());
  await user.click(opener('domain'));

  await user.keyboard('{Control>}c{/Control}');
  expect(field()).toBeNull();
  await user.keyboard('c');
  expect(document.activeElement).toBe(field());
  await user.keyboard('c');
  expect(field()).toHaveProperty('value', 'c');

  await user.click(within(inspector()).getByRole('heading', { level: 2 }));
  await user.keyboard('c');
  expect(document.activeElement).toBe(field());

  await user.click(within(rust).getByRole('button', { name: 'application: modified' }));
  expect(field()).toBeNull();
  await user.click(within(rust).getByRole('button', { name: 'domain: unchanged' }));
  expect(field()).not.toBeNull();
  expect(document.activeElement).not.toBe(field());
});

test('C focuses the field of a selected edge', async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={walkedReview()} send={async () => {}} />);
  const rust = await screen.findByRole('group', { name: 'rust' });
  await user.click(within(rust).getByRole('button', { name: 'application → domain: unchanged' }));
  await user.keyboard('c');
  const field = () => within(inspector()).getByRole('textbox', { name: 'Your comment' });
  expect(document.activeElement).toBe(field());

  await user.click(screen.getByRole('link', { name: /^Tests/ }));
  await user.click(screen.getByRole('link', { name: 'Structure' }));
  expect(field()).toBeTruthy();
  expect(document.activeElement).not.toBe(field());
});

test("C pressed before going to a part has finished drawing keeps the focus in the part's field", async () => {
  const user = userEvent.setup({ delay: null });
  render(
    <ReviewPage
      review={pageWith({
        range: `late-${crypto.randomUUID()}`,
        diff: {
          nodes: [
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
            webModule('utils', 'modified'),
            webFile('utils', 'x.ts', 'modified'),
            webFile('utils', 'y.ts'),
          ],
          edges: [],
        },
      })}
      notes={{
        version: 2,
        tests: '',
        summary: [{ text: 'Check y.ts', target: 'web/file/utils/y.ts' }],
        notes: {},
      }}
      send={async () => {}}
    />,
  );
  await screen.findByRole('group', { name: 'web' });
  scrolledIntoView.mockClear();

  await user.click(screen.getByRole('button', { name: 'Check y.ts' }));
  await user.keyboard('c');
  await screen.findByRole('button', { name: 'y.ts: unchanged' });
  await waitFor(() => expect(scrolledIntoView).toHaveBeenCalled());
  expect(document.activeElement).toBe(
    within(inspector()).getByRole('textbox', { name: 'Your comment' }),
  );
});

test('J, K and A typed in a comment are text, neither walking nor marking', async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={walkedReview()} send={async () => {}} />);
  await screen.findByRole('group', { name: 'rust' });

  await user.keyboard('j');
  await user.type(await partComment(user), 'jaj');
  expect(selectedPart()).toBe('application');
  expect(screen.getByText('0 of 3 parts read')).toBeDefined();
  expect(within(inspector()).getByRole('textbox', { name: 'Your comment' })).toHaveProperty(
    'value',
    'jaj',
  );
});

test('J walks the reading order with the All edges box focused', async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={walkedReview()} />);
  await screen.findByRole('group', { name: 'rust' });

  await user.click(await allEdges(user));
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
  await user.click(within(inspector()).getByRole('button', { name: "It's fine" }));
  await user.type(within(inspector()).getByRole('textbox', { name: "Why it's fine" }), 'jaj');
  expect(selectedPart()).toBe('application');
  expect(screen.getByText('0 of 3 parts read')).toBeDefined();
  expect(within(inspector()).getByRole('textbox', { name: "Why it's fine" })).toHaveProperty(
    'value',
    'jaj',
  );
});

test("Start here's line counts what needs a look and opens on it, ranked, in the lens a chip picks, folding when its count is pressed, each going to its node, five at most with All findings opening the rail; what is for information opens apart", async () => {
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
  const itemsOf = (list: string) =>
    within(band().getByRole('list', { name: list }))
      .getAllByRole('listitem')
      .map(item => within(item).getByRole('button').getAttribute('aria-label'));
  const items = () => itemsOf('Needs a look');
  expect(items()).toEqual(['cli-adapter: first', 'domain: second', 'application: third']);
  const count = () => band().getByRole('button', { name: '3 to look at' });
  expect(count().getAttribute('aria-expanded')).toBe('true');
  expect(band().queryByRole('list', { name: 'For information' })).toBeNull();

  await user.click(band().getByRole('button', { name: '1 for information' }));
  expect(itemsOf('For information')).toEqual(['application: lines 900, over 800']);
  expect(items()).toHaveLength(3);
  const contract = async () => (await lenses(user)).getByRole('button', { name: /Contract/ });
  await user.click(await contract());
  expect(items()).toEqual(['application: third']);
  await user.click(await contract());
  expect(items()).toHaveLength(3);

  await user.click(count());
  expect(band().queryByRole('list', { name: 'Needs a look' })).toBeNull();
  expect(count().getAttribute('aria-expanded')).toBe('false');
  await user.click(count());
  expect(items()).toHaveLength(3);
  await user.click(band().getByRole('button', { name: 'domain: second' }));
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'domain: unchanged' })),
  );
  expect(
    within(within(inspector()).getByRole('region', { name: 'Why look' })).getByRole('listitem', {
      current: true,
    }).textContent,
  ).toContain('second');

  const flags = Array.from({ length: 6 }, (_, index) =>
    flagged('rust/crate/domain', { id: `look ${index}`, title: `${index}` }),
  );
  rerender(<ReviewPage review={pageWith({ ...review, findings: flags })} />);
  expect(items()).toEqual([...['0', '1', '2', '3', '4'].map(title => `domain: ${title}`), null]);
  expect(band().getByRole('button', { name: '6 to look at' })).toBeDefined();
  expect(screen.queryByRole('complementary', { name: 'Findings' })).toBeNull();
  await user.click(band().getByRole('button', { name: 'and 1 more in All findings' }));
  expect(screen.getByRole('complementary', { name: 'Findings' })).toBeDefined();
  await user.click(screen.getByRole('button', { name: 'Hide findings' }));

  rerender(<ReviewPage review={pageWith({ ...review, findings: [] })} />);
  expect(band().getByText('nothing needs a look')).toBeDefined();
  expect(band().getByRole('button', { name: 'what was checked' })).toBeDefined();
  expect(band().queryByRole('button', { name: 'All findings' })).toBeNull();
});

test('with nothing to look at, Start here says so and still opens what is for information', async () => {
  const user = userEvent.setup();
  const { rerender } = render(
    <ReviewPage review={pageWith({ ...review, findings: [findingOn('rust/crate/domain')] })} />,
  );

  const band = within(await screen.findByRole('region', { name: 'Start here' }));
  expect(band.getByText('nothing needs a look')).toBeDefined();
  await user.click(band.getByRole('button', { name: '1 for information' }));
  expect(band.getByRole('button', { name: 'domain: lines 900, over 800' })).toBeDefined();

  rerender(
    <ReviewPage
      review={pageWith({
        ...review,
        findings: [findingOn('rust/crate/domain', { level: 'look' })],
      })}
    />,
  );
  expect(band.getByRole('button', { name: '1 to look at' })).toBeDefined();
  expect(band.getByRole('button', { name: '0 for information' })).toBeDefined();
});

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
  await openInformation(user);
  const signatures = () =>
    band.getByRole('button', { name: '7 exported signatures changed · 4 files' });
  expect(band.getByRole('button', { name: '30 exported symbols added · 9 files' })).toBeDefined();
  expect(
    band
      .getAllByRole('listitem')
      .map(line => within(line).getByRole('img').getAttribute('aria-label')),
  ).toEqual(['needs a look', 'for information']);
  expect(band.getByText('0.ts, 1.ts, 2.ts, 3.ts')).toBeDefined();
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
