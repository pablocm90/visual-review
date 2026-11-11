// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import type { SymbolStatement } from '../core/symbol-changes.ts';
import { symbolFindings } from '../core/symbol-findings.ts';
import { findingOn, measured, pageWith } from '../test-support/page-data.ts';
import {
  closeAndReopen,
  diffTab,
  draftOnTheUnchangedSymbol,
  editedAt,
  fold,
  fullDiffOpen,
  inspector,
  lastReviewSection,
  noteShown,
  openFold,
  openReview,
  pageWithAnUnchangedSymbol,
  pageWithSameNamedTests,
  partComment,
  patchOf,
  review,
  roundNote,
  roundRow,
  saidOnPart,
  scrolledIntoView,
  sentReview,
  showEverything,
  signatureLinesOf,
  sinceReview,
  symbolDiffRows,
  symbolDiffToggles,
  symbolGroups,
  symbolsOf,
  testedBy,
  toggleSymbolDiff,
  topFile,
  tray,
  twoFunctionsPatch,
  unchangedIf,
  unchangedSymbols,
  webFile,
  webModule,
  whatChanged,
  write,
} from './review-page.fixtures.tsx';
import { ReviewPage } from './review-page.tsx';

afterEach(() => history.replaceState(null, '', location.pathname));

test("a file's What changed lists its changed symbols grouped by change, counting them in its heading, its unchanged and formatting-only ones collapsed under a count, and is left out on a node with no symbol changes", async () => {
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
  expect(
    within(screen.getByRole('region', { name: 'What changed' })).getByRole('heading', {
      name: 'What changed 4',
    }),
  ).toBeTruthy();
  expect(symbolGroups()).toEqual([
    ['Edited', ['function refund: edited']],
    ['Added', ['class Refunds: added', 'method Refunds.void: added']],
    ['Removed', ['function cancel: removed']],
    ['Unchanged', ['function round: unchanged', 'function format: formatting']],
  ]);
  expect(
    within(screen.getByRole('region', { name: 'What changed' })).queryAllByRole('region'),
  ).toEqual([]);
  expect(
    within(screen.getByRole('region', { name: 'What changed' })).getByText('2 unchanged'),
  ).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'total.ts: modified' }));
  expect(screen.queryByRole('region', { name: 'What changed' })).toBeNull();
});

test("a file's What changed lists its API changes first: exported symbols added, removed, renamed, moved, un-exported or whose signature changed, a changed signature shown base then head, each symbol marked exported, now exported or no longer exported", async () => {
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
  const movedTo = screen.getByRole('listitem', { name: 'function tax: moved' });
  expect(movedTo.textContent).toBe('function tax moved to tax.ts');
  await user.click(within(movedTo).getByRole('button', { name: 'tax.ts' }));
  expect(within(inspector()).getByRole('heading', { level: 2 }).textContent).toBe('tax.ts');
  const movedFrom = screen.getByRole('listitem', { name: 'function tax: moved' });
  expect(movedFrom.textContent).toBe('function tax moved from refund.ts');
  await user.click(within(movedFrom).getByRole('button', { name: 'refund.ts' }));
  expect(within(inspector()).getByRole('heading', { level: 2 }).textContent).toBe('refund.ts');
});

test("a box's What changed lists each file inside it with symbol changes, each with its own groups; a logic line opens its own file's patch on its row, or at its top when outside every hunk, until another part is picked", async () => {
  const user = userEvent.setup();
  const inBilling = (label: string) => ({
    ...topFile(label, 'modified'),
    parent: 'web/module/billing',
    path: `web/src/billing/${label}`,
  });
  const symbol = (name: string, change: SymbolStatement['change']): SymbolStatement => ({
    name,
    lines: {},
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
  const files = within(screen.getByRole('region', { name: 'What changed' })).getAllByRole('region');
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
          [
            'function refund: edited',
            'added throw: throw new Late',
            'Diff under added throw: throw new Late',
            'added return: return late',
          ],
        ],
        [
          'Logic of function refund',
          [
            'added throw: throw new Late',
            'Diff under added throw: throw new Late',
            'added return: return late',
          ],
        ],
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
    within(screen.getByRole('list', { name: 'Logic of function refund' })).getByRole('button', {
      name: /^added throw/,
    }),
  );
  const changes = within(screen.getByRole('region', { name: 'Full diff' }));
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

  await user.click(
    within(screen.getByRole('list', { name: 'Logic of function refund' })).getByRole('button', {
      name: /^added return/,
    }),
  );
  const scrolled = scrolledIntoView.mock.contexts.at(-1);
  expect(scrolled instanceof HTMLElement && scrolled.getAttribute('aria-label')).toBe(
    'web/src/billing/refund.ts',
  );
  expect(document.querySelectorAll('[aria-current="true"]')).toHaveLength(0);

  await user.click(
    within(screen.getByRole('list', { name: 'Logic of function refund' })).getByRole('button', {
      name: /^added throw/,
    }),
  );
  await user.click(screen.getByRole('button', { name: 'outside.ts: modified' }));
  await user.click(screen.getByRole('button', { name: 'billing: modified' }));
  await openFold(user, 'Full diff');
  expect(
    within(screen.getByRole('region', { name: 'Full diff' }))
      .getAllByRole('group')
      .map(patch => patch.hasAttribute('open')),
  ).toEqual([false, false]);
  expect(document.querySelectorAll('[aria-current="true"]')).toHaveLength(0);
});

test("an edited function's logic lines show under it in What changed, each with its change, kind and text, a changed one base then head; a line that changed opens Full diff on its row, head side unless removed", async () => {
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
  const logic = within(screen.getByRole('region', { name: 'What changed' })).getByRole('list', {
    name: 'Logic of function refund',
  });
  expect(
    within(logic)
      .getAllByRole('listitem')
      .filter(item => item.hasAttribute('aria-label'))
      .map(item => item.getAttribute('aria-label')),
  ).toEqual([
    'removed guard: if (!paid) return',
    'Diff under removed guard: if (!paid) return',
    'same loop: for (const line of lines)',
    'changed if: if (a > 0) → if (a >= 0)',
    'added throw: throw new Late',
    'Diff under changed if: if (a > 0) → if (a >= 0), added throw: throw new Late',
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
  const strip = within(screen.getByRole('region', { name: 'What changed' })).getByRole('group', {
    name: 'Marks of function refund',
  });
  expect(
    within(screen.getByRole('region', { name: 'What changed' }))
      .getByRole('group', { name: 'Rows of function refund' })
      .hasAttribute('open'),
  ).toBe(true);
  expect(
    within(strip)
      .getAllByRole('button')
      .map(tick => tick.getAttribute('aria-label')),
  ).toEqual([
    'removed guard: if (!paid) return',
    'same loop: for (const line of lines)',
    'changed if: if (a > 0) → if (a >= 0)',
    'added throw: throw new Late',
  ]);
  expect(screen.getByText('3 of 4 · 2 exits')).toBeTruthy();
  const landed = () => {
    const row = scrolledIntoView.mock.contexts.at(-1);
    return row instanceof HTMLElement ? [row.textContent, row.getAttribute('aria-current')] : [];
  };

  await user.click(within(logic).getByRole('button', { name: /^changed if/ }));
  expect(fullDiffOpen()).toBe(true);
  expect(landed()).toEqual(['+    if (a >= 0) {', 'true']);
  await user.click(within(logic).getByRole('button', { name: /^removed guard/ }));
  expect(landed()).toEqual(['-  if (!paid) return;', 'true']);
});

test('a moved logic line names the symbol it moved to, and opens Full diff on its base row', async () => {
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
  const panel = within(screen.getByRole('list', { name: 'Logic of function refund' }));
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

test("a changed symbol's toggle opens only its own lines of the file's patch, in place and closed at first; an unchanged symbol has no toggle, nor has a symbol of a file with no patch", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        range: 'abc123..def456',
        diff: {
          nodes: [
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
            topFile('two.ts', 'modified'),
            topFile('nopatch.ts', 'modified'),
          ],
          edges: [],
        },
        symbols: [
          symbolsOf('web/file/two.ts', [
            editedAt('a', 1, 3),
            editedAt('b', 4, 6),
            { ...editedAt('still', 7, 9), change: 'unchanged' },
          ]),
          symbolsOf('web/file/nopatch.ts', [editedAt('c', 1, 3)]),
        ],
        patches: [twoFunctionsPatch()],
      })}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'two.ts: modified' }));
  expect(symbolDiffToggles()).toStrictEqual([
    ['Diff of function a', 'false'],
    ['Diff of function b', 'false'],
  ]);
  expect(symbolDiffRows('insertion')).toStrictEqual([]);

  await toggleSymbolDiff(user, 'a');
  expect(symbolDiffToggles()).toStrictEqual([
    ['Diff of function a', 'true'],
    ['Diff of function b', 'false'],
  ]);
  expect(symbolDiffRows('deletion')).toStrictEqual(['-  return 1;']);
  expect(symbolDiffRows('insertion')).toStrictEqual(['+  return 2;']);

  await toggleSymbolDiff(user, 'a');
  expect(symbolDiffRows('insertion')).toStrictEqual([]);

  await user.click(screen.getByRole('button', { name: 'nopatch.ts: modified' }));
  expect(within(whatChanged()).getByText('c')).toBeTruthy();
  expect(symbolDiffToggles()).toStrictEqual([]);
});

test("in a box's What changed a symbol's toggle opens its own file's patch", async () => {
  const user = userEvent.setup();
  const patchOfBilling = (file: string, text: string) =>
    patchOf(`web/src/billing/${file}`, '@@ -1 +1 @@', `-${text}`, `+${text}!`);
  render(
    <ReviewPage
      review={pageWith({
        range: 'abc123..def456',
        diff: {
          nodes: [
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
            webModule('billing', 'modified'),
            webFile('billing', 'a.ts', 'modified'),
            webFile('billing', 'b.ts', 'modified'),
          ],
          edges: [],
        },
        symbols: [
          symbolsOf('web/file/billing/a.ts', [editedAt('a', 1, 1)]),
          symbolsOf('web/file/billing/b.ts', [editedAt('b', 1, 1)]),
        ],
        patches: [patchOfBilling('a.ts', 'in a'), patchOfBilling('b.ts', 'in b')],
      })}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'billing: modified' }));
  await toggleSymbolDiff(user, 'b');
  expect(symbolDiffRows('insertion')).toStrictEqual(['+in b!']);
});

test('an opened symbol says so when its diff holds no changed line of its own, and when the rows leave out its first line', async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        range: 'abc123..def456',
        diff: {
          nodes: [
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
            topFile('three.ts', 'modified'),
          ],
          edges: [],
        },
        symbols: [
          symbolsOf('web/file/three.ts', [
            editedAt('deep', 1, 20),
            editedAt('whole', 21, 23),
            editedAt('elsewhere', 40, 42),
          ]),
        ],
        patches: [
          patchOf(
            'web/src/three.ts',
            '@@ -9,3 +9,3 @@',
            ' const before = 1;',
            '-const inner = 1;',
            '+const inner = 2;',
            '@@ -21,3 +21,3 @@',
            ' function whole() {',
            '-  return 1;',
            '+  return 2;',
          ),
        ],
      })}
    />,
  );
  const note = (name: string) =>
    within(screen.getByRole('listitem', { name: new RegExp(`function ${name}`) })).queryByRole(
      'note',
    )?.textContent;

  await user.click(await screen.findByRole('button', { name: 'three.ts: modified' }));
  await toggleSymbolDiff(user, 'deep');
  expect(note('deep')).toBe('Only its changed lines.');
  await toggleSymbolDiff(user, 'whole');
  expect(note('whole')).toBeUndefined();
  await toggleSymbolDiff(user, 'elsewhere');
  expect(note('elsewhere')).toBe('No line of its own changed.');
});

test("a last comment on a line shows under its own symbol's diff, not under another's line of the same text", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={{
        ...pageWith({
          range: review.range,
          diff: {
            nodes: [
              { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
              topFile('two.ts', 'modified'),
            ],
            edges: [],
          },
          symbols: [symbolsOf('web/file/two.ts', [editedAt('a', 1, 3), editedAt('b', 4, 6)])],
          patches: [
            patchOf(
              'web/src/two.ts',
              '@@ -1,6 +1,6 @@',
              ' function a() {',
              '-  return 1;',
              '+  return null;',
              ' }',
              ' function b() {',
              '-  return 1;',
              '+  return null;',
              ' }',
            ),
          ],
        }),
        sinceReview: {
          ...sinceReview,
          comments: [
            {
              anchor: { kind: 'line', id: 'web/src/two.ts@head:5', text: '  return null;' },
              kind: 'question',
              text: 'Why null here?',
            },
          ],
        },
      }}
    />,
  );
  const symbol = (name: string) =>
    within(whatChanged()).getByRole('listitem', { name: new RegExp(`^function ${name}`) });

  await user.click(await screen.findByRole('button', { name: 'two.ts: modified' }));
  await toggleSymbolDiff(user, 'a');
  await toggleSymbolDiff(user, 'b');

  expect(within(symbol('b')).getByText('Why null here?')).toBeTruthy();
  expect(within(symbol('a')).queryByText('Why null here?')).toBeNull();
});

test("a comment on a line of a symbol's diff shows in Full diff too, and the tray goes to it there", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        range: review.range,
        diff: {
          nodes: [
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
            topFile('two.ts', 'modified'),
          ],
          edges: [],
        },
        symbols: [symbolsOf('web/file/two.ts', [editedAt('a', 1, 3), editedAt('b', 4, 6)])],
        patches: [twoFunctionsPatch()],
      })}
      send={vi.fn(async () => {})}
    />,
  );
  const name = 'two.ts:2 "return 2;"';

  await user.click(await screen.findByRole('button', { name: 'two.ts: modified' }));
  await toggleSymbolDiff(user, 'a');
  await user.click(within(whatChanged()).getByRole('button', { name: `Comment on ${name}` }));
  await write(user, within(whatChanged()).getByRole('textbox', { name: 'Your comment' }), 'Why 2?');
  const inFullDiff = screen.getByRole('region', { name: 'Full diff' });
  expect(within(inFullDiff).getByRole('textbox', { name: 'Your comment' })).toHaveProperty(
    'value',
    'Why 2?',
  );

  await openReview(user);
  await user.click(
    within(screen.getByRole('list', { name: 'Drafts' })).getByRole('button', { name }),
  );
  const row = within(screen.getByRole('region', { name: 'Full diff' })).getByRole('insertion', {
    current: true,
  });
  expect(within(row).getByRole('textbox', { name: 'Your comment' })).toHaveProperty(
    'value',
    'Why 2?',
  );
});

test("a note on a diff line shows under its row in Full diff, open by itself, and under the same row in its symbol's Diff", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        range: review.range,
        diff: {
          nodes: [
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
            topFile('two.ts', 'modified'),
          ],
          edges: [],
        },
        symbols: [symbolsOf('web/file/two.ts', [editedAt('a', 1, 3), editedAt('b', 4, 6)])],
        patches: [twoFunctionsPatch()],
      })}
      notes={{
        version: 2,
        tests: '',
        summary: [],
        notes: { 'line web/src/two.ts@base:5': { text: 'Three was the old default.' } },
      }}
    />,
  );
  const noteIn = (region: HTMLElement) => {
    const row = within(region)
      .getAllByRole('deletion')
      .find(deleted => deleted.textContent?.startsWith('-  return 3;'));
    return (
      row && within(row).getByRole('region', { name: 'Note on two.ts:5 "return 3;"' }).textContent
    );
  };

  await user.click(await screen.findByRole('button', { name: 'two.ts: modified' }));
  expect(noteIn(diffTab())).toBe('Three was the old default.');

  await toggleSymbolDiff(user, 'b');
  expect(noteIn(whatChanged())).toBe('Three was the old default.');
});

test("on a served page Take on a diff line's note opens that row's field with the recommendation as a change, focused, and hides while the draft holds text", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        range: review.range,
        diff: {
          nodes: [
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
            topFile('two.ts', 'modified'),
          ],
          edges: [],
        },
        patches: [twoFunctionsPatch()],
      })}
      notes={{
        version: 2,
        tests: '',
        summary: [],
        notes: {
          'line web/src/two.ts@base:5': {
            text: 'Three was the old default.',
            recommendation: 'Keep 3 behind a flag.',
          },
        },
      }}
      send={async () => {}}
    />,
  );
  const row = () =>
    within(
      within(diffTab())
        .getAllByRole('deletion')
        .find(deleted => deleted.textContent?.startsWith('-  return 3;')) ?? document.body,
    );
  const field = () => row().getByRole('textbox', { name: 'Your comment' });
  const takeInRow = () => row().queryByRole('button', { name: 'Take' });

  await user.click(await screen.findByRole('button', { name: 'two.ts: modified' }));
  await user.click(row().getByRole('button', { name: 'Take' }));

  expect(document.activeElement).toBe(field());
  expect(field()).toHaveProperty('value', 'Keep 3 behind a flag.');
  expect(
    within(row().getByRole('radiogroup', { name: 'Comment kind' })).getByRole('radio', {
      name: 'Change this',
    }),
  ).toHaveProperty('checked', true);
  expect(within(tray()).getByText('1 drafted · 1 change')).toBeDefined();
  expect(takeInRow()).toBeNull();

  await user.clear(field());
  expect(takeInRow()).not.toBeNull();
});

test("the rail's flag on a diff line's note goes to its file and outlines that row in Full diff", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        range: review.range,
        diff: {
          nodes: [
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
            topFile('two.ts', 'modified'),
          ],
          edges: [],
        },
        patches: [twoFunctionsPatch()],
      })}
      notes={{
        version: 2,
        tests: '',
        summary: [],
        notes: {
          'line web/src/two.ts@head:5': { text: 'Four now.', flag: 'magic number' },
        },
      }}
    />,
  );

  await user.click(await screen.findByRole('button', { name: /^Show \d+ findings?$/ }));
  await user.click(
    within(screen.getByRole('complementary', { name: 'Findings' })).getByRole('button', {
      name: /^two\.ts: magic number/,
    }),
  );

  expect(within(diffTab()).getByRole('insertion', { current: true }).textContent).toMatch(
    /^\+ {2}return 4;/,
  );
});

test.for([
  { path: 'README.md', reading: {} },
  {
    path: 'config/routes.rb',
    reading: { routes: [{ file: 'config/routes.rb', notRead: 'Ruby syntax error' }] },
  },
  {
    path: 'db/schema.rb',
    reading: { schemas: [{ file: 'db/schema.rb', notRead: 'Ruby syntax error' }] },
  },
])(
  "the rail's flag on a line note in $path, outside the graph, opens those files on that row, the note under it, as its answer in the tray does",
  async ({ path, reading }) => {
    const user = userEvent.setup();
    render(
      <ReviewPage
        review={pageWith({
          ...review,
          ...reading,
          undrawn: [
            {
              path,
              patch: `--- a/${path}\n+++ b/${path}\n@@ -1,2 +1,2 @@\n one\n-old\n+new`,
            },
          ],
        })}
        notes={{
          version: 2,
          tests: '',
          summary: [],
          notes: { [`line ${path}@head:2`]: { text: 'Newer.', flag: 'stale wording' } },
        }}
        send={vi.fn(async () => {})}
      />,
    );
    const landedRow = () => within(inspector()).getByRole('insertion', { current: true });

    await user.click(await screen.findByRole('button', { name: /^Show \d+ findings?$/ }));
    const rail = screen.getByRole('complementary', { name: 'Findings' });
    await user.click(within(rail).getByRole('button', { name: /stale wording/ }));

    expect(within(inspector()).getByRole('heading', { level: 2 }).textContent).toBe(
      'Changed files outside the graph',
    );
    expect(landedRow().textContent).toContain('new');
    expect(
      within(landedRow()).getByRole('region', { name: new RegExp(`^Note on ${path}:2`) })
        .textContent,
    ).toBe('Newer.');

    const finding = within(rail).getByText('stale wording').closest('li') ?? rail;
    await user.click(within(finding).getByRole('button', { name: 'Fix this' }));
    await user.click(within(inspector()).getByRole('button', { name: 'Close inspector' }));
    await openReview(user);
    await user.click(
      within(screen.getByRole('list', { name: 'Drafts' })).getByRole('button', {
        name: 'stale wording',
      }),
    );

    expect(landedRow().textContent).toContain('new');
  },
);

test("a box's patch holding a line note opens by itself, its other patches closed", async () => {
  const user = userEvent.setup();
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
            ...['refund.ts', 'tax.ts'].map(file => ({
              ...topFile(file, 'modified'),
              parent: 'web/module/billing',
              path: `web/src/billing/${file}`,
            })),
          ],
          edges: [],
        },
        patches: ['refund.ts', 'tax.ts'].map(file =>
          patchOf(`web/src/billing/${file}`, '@@ -1 +1 @@', '-a', '+b'),
        ),
      })}
      notes={{
        version: 2,
        tests: '',
        summary: [],
        notes: { 'line web/src/billing/refund.ts@head:1': { text: 'b, not a.' } },
      }}
    />,
  );
  const patchOpen = (path: string) =>
    within(diffTab()).getByRole('group', { name: path }).hasAttribute('open');

  await user.click(await screen.findByRole('button', { name: 'billing: modified' }));

  expect(patchOpen('web/src/billing/refund.ts')).toBe(true);
  expect(patchOpen('web/src/billing/tax.ts')).toBe(false);
});

test('a symbol moved between files opens its lines from both, each named by its file, the one it left first, from either end', async () => {
  const user = userEvent.setup();
  const moved = {
    name: 'f',
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
            topFile('from.ts', 'modified'),
            topFile('to.ts', 'modified'),
          ],
          edges: [],
        },
        symbols: [
          symbolsOf('web/file/from.ts', [
            { ...moved, movedTo: 'web/file/to.ts', lines: { base: { start: 1, end: 2 } } },
          ]),
          symbolsOf('web/file/to.ts', [
            { ...moved, movedFrom: 'web/file/from.ts', lines: { head: { start: 5, end: 6 } } },
          ]),
        ],
        patches: [
          patchOf('web/src/from.ts', '@@ -1,3 +1 @@', '-function f() {', '-}', ' const kept = 1;'),
          patchOf('web/src/to.ts', '@@ -4 +4,3 @@', ' const before = 1;', '+function f() {', '+}'),
        ],
      })}
    />,
  );
  const sides = () =>
    within(whatChanged())
      .getAllByRole('region', { name: /^Lines in/ })
      .map(side => [
        side.getAttribute('aria-label'),
        ...within(side)
          .queryAllByRole('deletion')
          .concat(within(side).queryAllByRole('insertion'))
          .map(row => row.textContent),
      ]);
  const expected = [
    ['Lines in web/src/from.ts', '-function f() {', '-}'],
    ['Lines in web/src/to.ts', '+function f() {', '+}'],
  ];

  await user.click(await screen.findByRole('button', { name: 'from.ts: modified' }));
  await toggleSymbolDiff(user, 'f');
  expect(sides()).toStrictEqual(expected);

  await user.click(screen.getByRole('button', { name: 'to.ts: modified' }));
  await toggleSymbolDiff(user, 'f');
  expect(sides()).toStrictEqual(expected);
});

test("a file whose symbols wouldn't parse shows the parse error in its What changed, and in its box's", async () => {
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
  const whatChanged = () => screen.getByRole('region', { name: 'What changed' });

  await user.click(await screen.findByRole('button', { name: 'billing: modified' }));
  expect(within(whatChanged()).getByRole('heading', { name: 'What changed' })).toBeTruthy();
  expect(
    within(within(whatChanged()).getByRole('region', { name: 'refund.ts' })).getByText(
      'Unexpected token (3:4)',
      { exact: false },
    ),
  ).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'total.ts: modified' }));
  expect(within(whatChanged()).getByText('Missing semicolon (7:1)', { exact: false })).toBeTruthy();
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
  const symbolComment = () => within(whatChanged()).getByRole('textbox', { name: 'Your comment' });
  const commentOn = () =>
    within(whatChanged()).getByRole('button', { name: 'Comment on method ReviewPage.goTo' });

  await user.click(await screen.findByRole('button', { name: 'review-page.tsx: modified' }));
  await user.click(commentOn());
  await user.click(commentOn());
  expect(commentOn().getAttribute('aria-expanded')).toBe('false');
  expect(within(whatChanged()).queryByRole('textbox', { name: 'Your comment' })).toBeNull();
  await user.click(commentOn());
  expect(commentOn().getAttribute('aria-expanded')).toBe('true');
  await user.click(within(whatChanged()).getByRole('radio', { name: 'Change this' }));
  await user.type(symbolComment(), 'Split it.');
  await closeAndReopen(user, 'review-page.tsx: modified');
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
  expect(
    within(whatChanged()).getByRole('button', { name: 'Comment on same if: if (ready)' }),
  ).toBeTruthy();
  await user.click(
    within(whatChanged()).getByRole('button', {
      name: 'Comment on removed guard: if (!open) return',
    }),
  );
  await write(
    user,
    within(whatChanged()).getByRole('textbox', { name: 'Your comment' }),
    'Why did it move?',
  );
  await user.click(
    within(whatChanged()).getByRole('button', { name: 'Comment on changed if: if (a) → if (b)' }),
  );
  await write(
    user,
    within(
      within(whatChanged()).getByRole('listitem', { name: 'changed if: if (a) → if (b)' }),
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
  const [, later] = within(whatChanged()).getAllByRole('button', {
    name: 'Comment on removed guard: if (a) return',
  });
  await user.click(later ?? whatChanged());
  await write(user, within(whatChanged()).getByRole('textbox', { name: 'Your comment' }), 'Why?');
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

test("C opens the part's own comment, not those of the rows under it", async () => {
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
            },
          ]),
        ],
      })}
      send={async () => {}}
    />,
  );
  await user.click(await screen.findByRole('button', { name: 'review-page.tsx: modified' }));
  await user.keyboard('c');
  expect(within(inspector()).getAllByRole('textbox', { name: 'Your comment' })).toHaveLength(1);
});

test('a draft in the open tray goes to where it was written, though the inspector was closed', async () => {
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
  const partField = () =>
    within(inspector()).getAllByRole('textbox', { name: 'Your comment' })[0] ?? inspector();

  await user.click(await screen.findByRole('button', { name: 'review-page.tsx: modified' }));
  await partComment(user);
  await write(user, partField(), 'On the file.');
  await user.click(
    within(whatChanged()).getByRole('button', { name: 'Comment on method ReviewPage.goTo' }),
  );
  await write(
    user,
    within(
      within(whatChanged()).getByRole('listitem', { name: 'method ReviewPage.goTo: edited' }),
    ).getByRole('textbox', { name: 'Your comment' }),
    'On the method.',
  );
  await user.click(
    within(whatChanged()).getByRole('button', { name: 'Comment on same if: if (ready)' }),
  );
  await write(
    user,
    within(within(whatChanged()).getByRole('listitem', { name: 'same if: if (ready)' })).getByRole(
      'textbox',
      { name: 'Your comment' },
    ),
    'On the line.',
  );
  await user.click(screen.getByRole('button', { name: 'Close inspector' }));
  await openReview(user);

  const goToMethod = () =>
    user.click(screen.getByRole('button', { name: 'ReviewPage.goTo in review-page.tsx' }));
  const methodRow = () =>
    within(whatChanged()).getByRole('listitem', { name: 'method ReviewPage.goTo: edited' });
  await goToMethod();
  expect(within(methodRow()).getAllByRole('textbox', { name: 'Your comment' })[0]).toHaveProperty(
    'value',
    'On the method.',
  );
  expect(document.activeElement).toBe(methodRow());
  expect(scrolledIntoView.mock.contexts).toContain(methodRow());
  await goToMethod();
  expect(document.activeElement).toBe(methodRow());
  await user.click(
    within(screen.getByRole('list', { name: 'Drafts' })).getByRole('button', {
      name: 'review-page.tsx',
    }),
  );
  expect(partField()).toHaveProperty('value', 'On the file.');
  expect(methodRow().hasAttribute('aria-current')).toBe(false);
  await user.click(screen.getByRole('button', { name: 'if (ready)' }));
  const lineRow = within(whatChanged()).getByRole('listitem', { name: 'same if: if (ready)' });
  expect(within(lineRow).getByRole('textbox', { name: 'Your comment' })).toHaveProperty(
    'value',
    'On the line.',
  );
  expect(document.activeElement).toBe(lineRow);
  expect(scrolledIntoView.mock.contexts).toContain(lineRow);
  await user.click(
    within(screen.getByRole('list', { name: 'Drafts' })).getByRole('button', {
      name: 'review-page.tsx',
    }),
  );
  expect(inspector().scrollTop).toBe(0);
  scrolledIntoView.mockImplementationOnce(() => {
    inspector().scrollTop = 300;
  });
  await goToMethod();
  expect(inspector().scrollTop).toBe(300);
  await user.click(
    within(screen.getByRole('list', { name: 'Drafts' })).getByRole('button', {
      name: 'review-page.tsx',
    }),
  );
  expect(inspector().scrollTop).toBe(0);

  const partOpener = () =>
    within(inspector()).getByRole('button', { name: 'Comment on review-page.tsx' });
  await user.click(partOpener());
  expect(partOpener().getAttribute('aria-expanded')).toBe('false');
  await goToMethod();
  expect(partOpener().getAttribute('aria-expanded')).toBe('false');
  await user.click(
    within(screen.getByRole('list', { name: 'Drafts' })).getByRole('button', {
      name: 'review-page.tsx',
    }),
  );
  expect(partOpener().getAttribute('aria-expanded')).toBe('true');
  expect(partField()).toHaveProperty('value', 'On the file.');
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
    const row = within(within(whatChanged()).getByRole('list', { name: group })).getByRole(
      'listitem',
    );
    await user.click(within(row).getByRole('button', { name: `Comment on ${name}` }));
    await write(user, within(row).getByRole('textbox', { name: 'Your comment' }), text);
  };

  await user.click(await screen.findByRole('button', { name: 'tax.ts: modified' }));
  await commentIn('Edited', 'function F', 'On the edited one.');
  await commentIn('Added', 'type F', 'On the type.');
  await user.click(within(whatChanged()).getByText('1 unchanged'));
  await commentIn('Unchanged', 'function F', 'On the unchanged one.');
  await closeAndReopen(user, 'tax.ts: modified');
  expect(within(whatChanged()).getByRole('group').hasAttribute('open')).toBe(true);
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

test("the column reads a part's note, then Why look, then What changed, then Tested by; an edge's holds its note and findings only", async () => {
  const user = userEvent.setup();
  const edge = 'web/file/tax.ts -> web/file/vat.ts';
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
          edges: [{ from: 'web/file/tax.ts', to: 'web/file/vat.ts', state: 'added' }],
        },
        findings: [findingOn('web/file/tax.ts'), findingOn(edge)],
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
        tests: [
          {
            path: 'tax.test.ts',
            stack: 'web',
            statements: [{ kind: 'test', name: 'rounds', change: 'added' }],
          },
        ],
      })}
      notes={{
        version: 2,
        tests: '',
        summary: [],
        notes: {
          'part web/file/tax.ts': { text: 'Rounds now.' },
          [`edge ${edge}`]: { text: 'A new way in.' },
        },
      }}
    />,
  );
  const region = (name: string) => within(inspector()).queryByRole('region', { name });
  const follows = (first: Element | null, second: Element | null) =>
    first !== null &&
    second !== null &&
    (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

  await user.click(await screen.findByRole('button', { name: 'tax.ts: modified' }));
  expect(follows(within(inspector()).getByText('Rounds now.'), region('Why look'))).toBe(true);
  expect(follows(region('Why look'), region('What changed'))).toBe(true);
  expect(follows(region('What changed'), region('Tested by'))).toBe(true);

  await user.click(screen.getByRole('button', { name: 'tax.ts → vat.ts: added' }));
  expect(noteShown()).toBe('A new way in.');
  expect(region('Why look')).not.toBeNull();
  expect(region('What changed')).toBeNull();
});

test('a part with no note starts at what else its column holds, and says "No note" only when it holds nothing', async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        range: review.range,
        diff: {
          nodes: [
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
            topFile('tax.ts', 'modified'),
            topFile('vat.ts', 'modified'),
            topFile('bare.ts', 'modified'),
            topFile('rate.ts', 'modified'),
          ],
          edges: [],
        },
        findings: [findingOn('web/file/vat.ts')],
        tests: [
          {
            path: 'rate.test.ts',
            stack: 'web',
            statements: [{ kind: 'test', name: 'rounds', change: 'added' }],
          },
        ],
        symbols: [
          symbolsOf('web/file/tax.ts', [
            {
              name: 'tax',
              kind: 'function',
              exported: { base: false, head: false },
              change: 'edited',
            },
          ]),
          symbolsOf('web/file/bare.ts', [
            {
              name: 'bare',
              kind: 'function',
              exported: { base: false, head: false },
              change: 'unchanged',
            },
          ]),
        ],
      })}
    />,
  );
  const saysNoNote = () => within(inspector()).queryByText('No note') !== null;

  await user.click(await screen.findByRole('button', { name: 'bare.ts: modified' }));
  expect(saysNoNote()).toBe(true);
  expect(within(inspector()).queryByRole('region', { name: 'What changed' })).toBeNull();

  await user.click(screen.getByRole('button', { name: 'tax.ts: modified' }));
  expect(within(inspector()).getByRole('region', { name: 'What changed' })).toBeTruthy();
  expect(saysNoNote()).toBe(false);

  await user.click(screen.getByRole('button', { name: /^vat\.ts: modified/ }));
  expect(within(inspector()).getByRole('region', { name: 'Why look' })).toBeTruthy();
  expect(saysNoNote()).toBe(false);

  await user.click(screen.getByRole('button', { name: 'rate.ts: modified' }));
  expect(within(inspector()).getByRole('region', { name: 'Tested by' })).toBeTruthy();
  expect(saysNoNote()).toBe(false);
});

test('a part with no note but a last comment shows that comment, not "No note"', async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWith({
        range: review.range,
        diff: {
          nodes: [
            { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
            topFile('said.ts', 'modified'),
            topFile('bare.ts', 'modified'),
          ],
          edges: [],
        },
        sinceReview: {
          ...sinceReview,
          comments: [saidOnPart('web/file/said.ts', { text: 'Why the rounding?' })],
        },
      })}
    />,
  );
  const saysNoNote = () => within(inspector()).queryByText('No note') !== null;

  await user.click(await screen.findByRole('button', { name: 'bare.ts: modified' }));
  expect(saysNoNote()).toBe(true);

  await user.click(screen.getByRole('button', { name: /^said\.ts: modified/ }));
  expect(within(inspector()).getByText('Why the rounding?')).toBeTruthy();
  expect(saysNoNote()).toBe(false);
});

test('an open fold stays open between parts, and closes when the inspector does or Structure is left', async () => {
  const user = userEvent.setup();
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
        metrics: {
          'web/file/tax.ts': { base: measured(), head: measured() },
          'web/file/vat.ts': { base: measured(), head: measured() },
        },
      })}
    />,
  );
  const metricsOpen = () =>
    within(inspector()).getByRole('button', { name: 'Metrics' }).getAttribute('aria-expanded');

  await user.click(await screen.findByRole('button', { name: 'tax.ts: modified' }));
  expect(metricsOpen()).toBe('false');
  await openFold(user, 'Metrics');
  await user.click(screen.getByRole('button', { name: 'vat.ts: modified' }));
  expect(metricsOpen()).toBe('true');

  await user.click(within(inspector()).getByRole('button', { name: 'Close inspector' }));
  await user.click(screen.getByRole('button', { name: 'tax.ts: modified' }));
  expect(metricsOpen()).toBe('false');

  await openFold(user, 'Metrics');
  await user.click(screen.getByRole('link', { name: /^Tests/ }));
  await screen.findByRole('group', { name: 'Tests shown' });
  await user.click(screen.getByRole('link', { name: /^Structure/ }));
  await screen.findByRole('button', { name: 'tax.ts: modified' });
  expect(metricsOpen()).toBe('false');
});

test('an open fold stays open through an edge selected between two parts', async () => {
  const user = userEvent.setup();
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
        metrics: {
          'web/file/tax.ts': { base: measured(), head: measured() },
          'web/file/vat.ts': { base: measured(), head: measured() },
        },
      })}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'tax.ts: modified' }));
  await openFold(user, 'Metrics');
  await user.click(screen.getByRole('button', { name: 'tax.ts → vat.ts: added' }));
  await user.click(screen.getByRole('button', { name: 'vat.ts: modified' }));

  expect(fold('Metrics')).not.toBeNull();
  expect(within(inspector()).getByRole('rowheader', { name: /^Lines/ })).toBeTruthy();
});

test('going to a finding answer in the open tray lands on its row, whatever fold is open', async () => {
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
        metrics: { 'web/file/tax.ts': { base: measured(), head: measured() } },
      })}
      send={async () => {}}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'tax.ts: modified' }));
  await user.click(within(inspector()).getByRole('button', { name: 'Fix this' }));
  await openFold(user, 'Metrics');
  await openReview(user);
  await user.click(screen.getByRole('button', { name: 'lines 900, over 800' }));

  const row = within(within(inspector()).getByRole('list', { name: 'Findings' })).getByRole(
    'listitem',
    { current: true },
  );
  expect(within(row).getByRole('button', { name: 'Fix this' })).toBeDefined();
  expect(document.activeElement).toBe(row);
  expect(scrolledIntoView.mock.contexts).toContain(row);
});

test('going to a draft on an unchanged symbol opens the fold again, though it was closed by hand', async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={pageWithAnUnchangedSymbol()} send={vi.fn(async () => {})} />);

  await user.click(await screen.findByRole('button', { name: 'tax.ts: modified' }));
  await draftOnTheUnchangedSymbol(user);
  await user.click(within(whatChanged()).getByText('1 unchanged'));
  expect(unchangedSymbols().hasAttribute('open')).toBe(false);
  await openReview(user);
  await user.click(screen.getByRole('button', { name: /^round in tax\.ts/ }));

  expect(unchangedSymbols().hasAttribute('open')).toBe(true);
  expect(document.activeElement).toBe(
    within(unchangedSymbols()).getByRole('listitem', { name: 'function round: unchanged' }),
  );
});

test('the unchanged symbols open by themselves when one holds a draft', async () => {
  const user = userEvent.setup();
  render(<ReviewPage review={pageWithAnUnchangedSymbol()} send={vi.fn(async () => {})} />);

  await user.click(await screen.findByRole('button', { name: 'tax.ts: modified' }));
  expect(unchangedSymbols().hasAttribute('open')).toBe(false);
  await draftOnTheUnchangedSymbol(user);
  await closeAndReopen(user, 'tax.ts: modified');

  expect(unchangedSymbols().hasAttribute('open')).toBe(true);
});

test("a symbol's note shows under its row, with its why and recommendation, and opens the unchanged fold holding it", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWithAnUnchangedSymbol()}
      notes={{
        version: 2,
        tests: '',
        summary: [],
        notes: {
          'symbol web/file/tax.ts#round': {
            text: 'Rounds half up.',
            why: 'Tax rounds to the cent.',
            recommendation: 'Round half to even.',
          },
        },
      }}
    />,
  );
  const noteUnder = (name: string) =>
    within(within(whatChanged()).getByRole('listitem', { name })).queryByRole('region', {
      name: /^Note/,
    })?.textContent;

  await user.click(await screen.findByRole('button', { name: 'tax.ts: modified' }));

  expect(unchangedSymbols().hasAttribute('open')).toBe(true);
  expect(noteUnder('function round: unchanged')).toBe(
    'Rounds half up.Why Tax rounds to the cent.Recommendation Round half to even.',
  );
  expect(noteUnder('function tax: edited')).toBeUndefined();
  expect(
    within(
      within(whatChanged()).getByRole('listitem', { name: 'function round: unchanged' }),
    ).queryByRole('button', { name: 'Take' }),
  ).toBeNull();
});

test("on a served page Take on a symbol's note opens that row's field with the recommendation as a change, focused, and hides while the draft holds text", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage review={pageWithAnUnchangedSymbol()} notes={roundNote} send={async () => {}} />,
  );
  const field = () => within(roundRow()).getByRole('textbox', { name: 'Your comment' });
  const takeInRow = () => within(roundRow()).queryByRole('button', { name: 'Take' });

  await user.click(await screen.findByRole('button', { name: 'tax.ts: modified' }));
  await user.click(within(roundRow()).getByRole('button', { name: 'Take' }));

  expect(document.activeElement).toBe(field());
  expect(field()).toHaveProperty('value', 'Round half to even.');
  expect(
    within(within(roundRow()).getByRole('radiogroup', { name: 'Comment kind' })).getByRole(
      'radio',
      { name: 'Change this' },
    ),
  ).toHaveProperty('checked', true);
  expect(within(tray()).getByText('1 drafted · 1 change')).toBeDefined();
  expect(takeInRow()).toBeNull();

  await user.clear(field());
  expect(takeInRow()).not.toBeNull();
});

test("Take on a symbol the last review commented on fills that comment's Reply, open and focused", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={{
        ...pageWithAnUnchangedSymbol(),
        sinceReview: {
          ...sinceReview,
          comments: [
            {
              anchor: { kind: 'symbol', id: 'web/file/tax.ts#round' },
              kind: 'question',
              text: 'Why?',
            },
          ],
        },
      }}
      notes={roundNote}
      send={async () => {}}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'tax.ts: modified' }));
  await user.click(within(roundRow()).getByRole('button', { name: 'Take' }));

  expect(
    within(roundRow()).getByRole('button', { name: 'Reply' }).getAttribute('aria-expanded'),
  ).toBe('true');
  const field = within(roundRow()).getByRole('textbox', { name: 'Your comment' });
  expect(document.activeElement).toBe(field);
  expect(field).toHaveProperty('value', 'Round half to even.');
});

test("the rail's flag on a symbol's note goes to its file and outlines the symbol's row", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWithAnUnchangedSymbol()}
      notes={{
        ...roundNote,
        notes: { 'symbol web/file/tax.ts#round': { text: 'Rounds half up.', flag: 'half up' } },
      }}
    />,
  );

  await user.click(await screen.findByRole('button', { name: /^Show \d+ findings?$/ }));
  await user.click(
    within(screen.getByRole('complementary', { name: 'Findings' })).getByRole('button', {
      name: /^tax\.ts: half up/,
    }),
  );

  expect(roundRow().getAttribute('aria-current')).toBe('true');
});

test.each([
  ['symbol web/file/refund.ts#round', 'Note on function round'],
  ['decision web/file/refund.ts#round#if (half)', 'Note on same if: if (half)'],
])(
  'a box shows a file whose only news is a note keyed %s, its unchanged fold open',
  async (key, region) => {
    const user = userEvent.setup();
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
              {
                ...topFile('refund.ts', 'modified'),
                parent: 'web/module/billing',
                path: 'web/src/billing/refund.ts',
              },
            ],
            edges: [],
          },
          symbols: [
            symbolsOf('web/file/refund.ts', [
              {
                name: 'round',
                kind: 'function',
                exported: { base: false, head: false },
                change: 'unchanged',
                logic: [unchangedIf('half', 1)],
              },
            ]),
          ],
        })}
        notes={{
          version: 2,
          tests: '',
          summary: [],
          notes: { [key]: { text: 'Rounds half up.' } },
        }}
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'billing: modified' }));

    const file = within(within(whatChanged()).getByRole('region', { name: 'refund.ts' }));
    expect(file.getByRole('group', { name: 'Unchanged symbols' }).hasAttribute('open')).toBe(true);
    expect(file.getByRole('region', { name: region }).textContent).toBe('Rounds half up.');
  },
);

test('a page that is not served has no Comment toggle on a symbol or a logic line', async () => {
  const user = userEvent.setup();
  const page = pageWithAnUnchangedSymbol();
  const { rerender } = render(<ReviewPage review={page} send={vi.fn(async () => {})} />);
  const toggles = () =>
    within(whatChanged())
      .queryAllByRole('button', { name: /^Comment on/ })
      .map(toggle => toggle.getAttribute('aria-label'));

  await user.click(await screen.findByRole('button', { name: 'tax.ts: modified' }));
  expect(toggles()).toContain('Comment on function tax');
  expect(toggles()).toContain('Comment on added guard: if (!rate) return');

  rerender(<ReviewPage review={page} />);
  expect(toggles()).toStrictEqual([]);
});

test('a note on a test shows under its row in Tested by, an unchanged test kept for it, and on the Tests screen, under no other row', async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={{
        ...pageWithSameNamedTests(),
        tests: [
          {
            path: 'total.test.ts',
            stack: 'web',
            statements: [
              {
                kind: 'heading',
                name: 'Cart',
                children: [
                  { kind: 'test', name: 'adds tax', change: 'added' },
                  { kind: 'test', name: 'keeps totals', change: 'unchanged' },
                ],
              },
            ],
          },
        ],
      }}
      notes={{
        version: 2,
        tests: '',
        summary: [],
        notes: {
          'test total.test.ts#Cart › keeps totals': {
            text: 'Pins the cent.',
            why: 'Totals round per line.',
          },
        },
      }}
    />,
  );
  const noteIn = (region: HTMLElement) => {
    const row = within(region).getByRole('listitem', { name: 'keeps totals: unchanged' });
    expect(within(region).getAllByRole('region', { name: /^Note on/ })).toHaveLength(1);
    return within(row).getByRole('region', { name: 'Note on Cart › keeps totals' }).textContent;
  };

  await user.click(await screen.findByRole('button', { name: 'total.ts: modified' }));
  expect(noteIn(testedBy())).toBe('Pins the cent.Why Totals round per line.');

  await user.click(screen.getByRole('link', { name: /^Tests/ }));
  expect(noteIn(screen.getByRole('region', { name: 'Test changes' }))).toBe(
    'Pins the cent.Why Totals round per line.',
  );
});

test("on a served page Take on a test's note opens that row's field with the recommendation as a change, focused, in Tested by and on the Tests screen, and hides while the draft holds text", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={pageWithSameNamedTests()}
      notes={{
        version: 2,
        tests: '',
        summary: [],
        notes: {
          'test total.test.ts#Cart › adds tax': {
            text: 'Adds tax once.',
            recommendation: 'Add it per line.',
          },
        },
      }}
      send={async () => {}}
    />,
  );
  const row = (region: HTMLElement) =>
    within(within(region).getByRole('listitem', { name: 'adds tax: added' }));
  const field = (region: HTMLElement) => row(region).getByRole('textbox', { name: 'Your comment' });
  const take = (region: HTMLElement) => row(region).queryByRole('button', { name: 'Take' });
  const takenIn = async (region: () => HTMLElement) => {
    await user.click(row(region()).getByRole('button', { name: 'Take' }));
    expect(document.activeElement).toBe(field(region()));
    expect(field(region())).toHaveProperty('value', 'Add it per line.');
    expect(
      within(row(region()).getByRole('radiogroup', { name: 'Comment kind' })).getByRole('radio', {
        name: 'Change this',
      }),
    ).toHaveProperty('checked', true);
    expect(within(tray()).getByText('1 drafted · 1 change')).toBeDefined();
    expect(take(region())).toBeNull();
    await user.clear(field(region()));
    expect(take(region())).not.toBeNull();
  };

  await user.click(await screen.findByRole('button', { name: 'total.ts: modified' }));
  await takenIn(testedBy);

  await user.click(screen.getByRole('link', { name: /^Tests/ }));
  const testChanges = () => screen.getByRole('region', { name: 'Test changes' });
  expect(document.activeElement).not.toBe(field(testChanges()));
  await takenIn(testChanges);
});

test("Take on a test's note on the Tests screen needs no node selected, and a page not served offers none", async () => {
  const user = userEvent.setup();
  const notes = {
    version: 2,
    tests: '',
    summary: [],
    notes: {
      'test total.test.ts#Cart › adds tax': {
        text: 'Adds tax once.',
        recommendation: 'Add it per line.',
      },
    },
  } as const;
  const { rerender } = render(<ReviewPage review={pageWithSameNamedTests()} notes={notes} />);
  const row = () =>
    within(
      within(screen.getByRole('region', { name: 'Test changes' })).getByRole('listitem', {
        name: 'adds tax: added',
      }),
    );

  await user.click(await screen.findByRole('link', { name: /^Tests/ }));
  expect(row().getByRole('region', { name: 'Note on Cart › adds tax' })).toBeDefined();
  expect(row().queryByRole('button', { name: 'Take' })).toBeNull();

  rerender(<ReviewPage review={pageWithSameNamedTests()} notes={notes} send={async () => {}} />);
  await user.click(row().getByRole('button', { name: 'Take' }));
  expect(document.activeElement).toBe(row().getByRole('textbox', { name: 'Your comment' }));
  expect(row().getByRole('textbox', { name: 'Your comment' })).toHaveProperty(
    'value',
    'Add it per line.',
  );
});

test("a served page's test row in Tested by takes a comment, a removed test too, its id the test's file and headings, so tests of one name keep apart; a page not served has no toggle", async () => {
  const user = userEvent.setup();
  const sent = vi.fn(async () => {});
  const page = pageWithSameNamedTests();
  const { rerender } = render(<ReviewPage review={page} send={sent} />);
  const commentOn = async (name: string, rowName: string, text: string) => {
    const row = within(within(testedBy()).getByRole('listitem', { name: rowName }));
    await user.click(row.getByRole('button', { name: `Comment on ${name}` }));
    await write(user, row.getByRole('textbox', { name: 'Your comment' }), text);
  };

  await user.click(await screen.findByRole('button', { name: 'total.ts: modified' }));
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
  expect(within(testedBy()).queryAllByRole('button', { name: /^Comment on/ })).toStrictEqual([]);
});

test("going to a test's draft lands on its row in Tested by, the row taking the focus; a last comment on a test the page no longer holds focuses the graph node", async () => {
  const user = userEvent.setup();
  render(
    <ReviewPage
      review={{
        ...pageWithSameNamedTests(),
        sinceReview: {
          ...sinceReview,
          comments: [
            {
              anchor: { kind: 'test', id: 'total.test.ts#gone' },
              kind: 'question',
              text: 'Still needed?',
              target: 'web/file/total.ts',
            },
          ],
        },
      }}
      send={async () => {}}
    />,
  );
  const tillRow = () => within(testedBy()).getByRole('listitem', { name: 'adds tax: edited' });

  await user.click(await screen.findByRole('button', { name: 'total.ts: modified' }));
  await user.click(
    within(tillRow()).getByRole('button', { name: 'Comment on Till › at noon › adds tax' }),
  );
  await write(user, within(tillRow()).getByRole('textbox', { name: 'Your comment' }), 'Why noon?');
  await user.click(screen.getByRole('button', { name: 'Close inspector' }));
  await openReview(user);
  await user.click(screen.getByRole('button', { name: 'adds tax' }));

  expect(tillRow().getAttribute('aria-current')).toBe('true');
  expect(document.activeElement).toBe(tillRow());
  expect(scrolledIntoView.mock.contexts).toContain(tillRow());

  await user.click(within(lastReviewSection()).getByRole('button', { name: /gone/ }));
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'total.ts: modified' }));
});
