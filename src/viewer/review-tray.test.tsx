// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import type { Comment } from '../core/review.ts';
import { anchorKey } from './anchors.ts';
import { ReviewTray } from './review-tray.tsx';

const nodes = [
  { id: 'web/module/src/cart', label: 'cart', path: 'web/src/cart' },
  { id: 'web/file/src/cart/total.ts', label: 'total.ts', path: 'web/src/cart/total.ts' },
  { id: 'web/file/src/pay.ts', label: 'pay.ts', path: 'web/src/pay.ts' },
];

const drafted = (anchor: Comment['anchor']): Comment => ({
  anchor,
  kind: 'question',
  text: 'Why?',
});

const renderTray = (
  comments: ReadonlyArray<Comment>,
  { onGoTo = vi.fn(), read = [] }: { onGoTo?: () => void; read?: ReadonlyArray<string> } = {},
) => {
  render(
    <ReviewTray
      reviewed={{ range: 'a..b' }}
      read={read}
      parts={['web/file/src/pay.ts', 'web/file/src/cart/total.ts']}
      comments={Object.fromEntries(comments.map(comment => [anchorKey(comment.anchor), comment]))}
      answers={{}}
      findings={[]}
      nodes={nodes}
      onGoTo={onGoTo}
      send={async () => {}}
    />,
  );
  return onGoTo;
};

test("the open tray names each draft by its anchor, sorts it with its file's part in reading order, and goes to that part", async () => {
  const user = userEvent.setup();
  const onGoTo = renderTray([
    drafted({ kind: 'test', id: 'web/src/cart/total.test.ts#Cart › adds tax' }),
    drafted({ kind: 'symbol', id: 'web/file/src/cart/total.ts#Cart.total' }),
    drafted({ kind: 'line', id: 'README.md@head:1', text: '# Shop' }),
    drafted({ kind: 'part', id: 'web/file/src/pay.ts' }),
  ]);
  await user.click(screen.getByRole('button', { name: 'Review' }));

  const drafts = within(screen.getByRole('list', { name: 'Drafts' }));
  expect(drafts.getAllByRole('listitem').map(item => item.textContent)).toEqual([
    'pay.ts Question: Why?',
    'Cart.total in total.ts Question: Why?',
    'README.md:1 "# Shop" Question: Why?',
    'adds tax Question: Why?',
  ]);
  expect(
    within(screen.getByLabelText('What Claude gets')).getByText(/README/).textContent,
  ).toContain('question  README.md:1 "# Shop"');
  expect(drafts.queryByRole('button', { name: /README/ })).toBeNull();
  await user.click(drafts.getByRole('button', { name: 'Cart.total in total.ts' }));
  expect(onGoTo).toHaveBeenCalledWith('web/file/src/cart/total.ts');
});

test('a part read with a comment on something inside it is not listed as read with nothing to say', async () => {
  const user = userEvent.setup();
  renderTray([drafted({ kind: 'symbol', id: 'web/file/src/cart/total.ts#Cart.total' })], {
    read: ['web/file/src/pay.ts', 'web/file/src/cart/total.ts'],
  });
  await user.click(screen.getByRole('button', { name: 'Review' }));

  const silent = within(screen.getByRole('list', { name: 'Read, nothing to say' }));
  expect(silent.getAllByRole('listitem').map(item => item.textContent)).toEqual(['pay.ts']);
});
