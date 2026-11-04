import { createContext, type ReactNode, useContext, useMemo } from 'react';
import type { PreviousComment } from '../core/previous-comments.ts';
import type { Comment } from '../core/review.ts';
import type { SinceReview } from '../core/since-review.ts';
import { anchorKey } from './anchors.ts';
import { COMMENT_KINDS } from './comment-field.tsx';
import { ANSWER_KINDS } from './finding-display.tsx';
import { Ref } from './ref.tsx';

const kindLabels = new Map<string, string>([...COMMENT_KINDS, ...ANSWER_KINDS]);

type Marked = { readonly comment: PreviousComment; readonly compared: boolean };

const markOf = ({ comment: { changedSince }, compared }: Marked) => {
  if (changedSince !== undefined) return 'Changed since';
  return compared ? 'As it was' : undefined;
};

export const saidLabel = (said: Marked): string => {
  const label = kindLabels.get(said.comment.kind);
  const mark = markOf(said);
  return mark === undefined ? `${label}` : `${label}, ${mark}`;
};

export const Said = (said: Marked) => {
  const { kind, text, changedSince = [] } = said.comment;
  const mark = markOf(said);
  return (
    <>
      <span className="draft-kind">{kindLabels.get(kind)}</span>
      {mark !== undefined && <span className="last-mark">{mark}</span>}
      {text !== undefined && <p className="last-said">{text}</p>}
      {changedSince.length > 0 && (
        <ul className="last-commits">
          {changedSince.map(({ sha, subject }) => (
            <li key={sha}>
              <Ref name={sha} /> <span>{subject}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
};

const keyOf = ({ anchor, target }: PreviousComment) =>
  anchorKey(
    (anchor.kind === 'part' || anchor.kind === 'edge') && target !== undefined
      ? { kind: anchor.kind, id: target }
      : anchor,
  );

const SaidOnThisPage = createContext<{
  readonly byAnchor: ReadonlyMap<string, PreviousComment>;
  readonly compared: boolean;
}>({ byAnchor: new Map(), compared: false });

type LastSaidOnPageProps = {
  readonly since: SinceReview | undefined;
  readonly children: ReactNode;
};

export const LastSaidOnPage = ({ since, children }: LastSaidOnPageProps) => {
  const said = useMemo(
    () => ({
      byAnchor: new Map(since?.comments.map(comment => [keyOf(comment), comment])),
      compared: since !== undefined && 'changed' in since,
    }),
    [since],
  );
  return <SaidOnThisPage.Provider value={said}>{children}</SaidOnThisPage.Provider>;
};

export const SaidBefore = ({ on }: { readonly on: Pick<Comment['anchor'], 'kind' | 'id'> }) => {
  const { byAnchor, compared } = useContext(SaidOnThisPage);
  const comment = byAnchor.get(anchorKey(on));
  if (comment === undefined) return null;
  return (
    <div
      role="note"
      className="said-before"
      aria-label={`Last review: ${saidLabel({ comment, compared })}`}
    >
      <Said comment={comment} compared={compared} />
    </div>
  );
};
