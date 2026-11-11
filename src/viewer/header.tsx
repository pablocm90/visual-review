import { useEffect, useState } from 'react';
import { type PageData, UNCOMMITTED } from '../core/page.ts';
import type { SinceReview } from '../core/since-review.ts';
import { ShortRange } from './graph-drawing.tsx';
import { partsRead } from './reading-order-list.tsx';
import { Ref } from './ref.tsx';
import { verdictLabels } from './review-tray.tsx';
import { changedCount } from './tests-screen.tsx';

const TABS = {
  structure: 'Structure',
  tests: 'Tests',
  schema: 'Schema',
  routes: 'Routes',
} as const;

export type Tab = keyof typeof TABS;

const tabsOf = ({ schemas, routes }: Pick<PageData, 'schemas' | 'routes'>): ReadonlyArray<Tab> => [
  'structure',
  'tests',
  ...(schemas.length === 0 ? [] : (['schema'] as const)),
  ...(routes.length === 0 ? [] : (['routes'] as const)),
];

const tabAt = (review: PageData, hash: string): Tab =>
  tabsOf(review).find(tab => `#${tab}` === hash) ?? 'structure';

export const useTab = (review: PageData): Tab => {
  const [tab, setTab] = useState(() => tabAt(review, location.hash));
  useEffect(() => {
    const follow = () => setTab(tabAt(review, location.hash));
    addEventListener('hashchange', follow);
    return () => removeEventListener('hashchange', follow);
  }, [review]);
  return tab;
};

type HeaderProps = {
  readonly review: PageData;
  readonly tab: Tab;
  readonly read: ReadonlySet<string>;
};

const LastVerdict = ({ since }: { readonly since: SinceReview }) => (
  <p className="where">
    Last review at <Ref name={since.head} />: {verdictLabels.get(since.verdict)}
  </p>
);

const UncomparedReview = ({ since }: { readonly since: SinceReview }) => {
  if ('gone' in since)
    return (
      <p className="where">
        The commit last reviewed, <Ref name={since.head} />, is gone: the full review is shown.
      </p>
    );
  if ('unreadable' in since)
    return (
      <p className="where" title={since.unreadable}>
        The commit last reviewed, <Ref name={since.head} />, couldn't be read: the full review is
        shown.
      </p>
    );
  return null;
};

type ReadingProgressProps = {
  readonly parts: ReadonlyArray<string>;
  readonly read: ReadonlySet<string>;
};

const ReadingProgress = ({ parts, read }: ReadingProgressProps) => {
  if (parts.length === 0) return null;
  const count = parts.filter(part => read.has(part)).length;
  return (
    <p className="reading-progress">
      {partsRead({ read: count, parts: parts.length })}{' '}
      <progress aria-label="Parts read" value={count} max={parts.length} />
    </p>
  );
};

export const Header = ({ review, tab, read }: HeaderProps) => {
  const changed = changedCount(review.tests);
  return (
    <header className="review">
      <div className="title">
        <p className="where">
          {review.repo} ·{' '}
          <code>
            <ShortRange range={review.range} />
          </code>
        </p>
        <h1>
          {review.pullRequest ? (
            <a href={review.pullRequest.url}>
              #{review.pullRequest.number} {review.pullRequest.title}
            </a>
          ) : review.range === UNCOMMITTED ? (
            'Uncommitted work'
          ) : (
            <ShortRange range={review.range} />
          )}
        </h1>
        {review.sinceReview !== undefined && (
          <>
            <LastVerdict since={review.sinceReview} />
            <UncomparedReview since={review.sinceReview} />
          </>
        )}
        <ReadingProgress parts={review.readingOrder.parts} read={read} />
      </div>
      <nav aria-label="Review">
        {tabsOf(review).map(shown => (
          <a key={shown} href={`#${shown}`} aria-current={shown === tab ? 'page' : undefined}>
            {TABS[shown]}
            {shown === 'tests' && changed > 0 && (
              <>
                {' '}
                <span className="badge">{changed}</span>
              </>
            )}
          </a>
        ))}
      </nav>
    </header>
  );
};
