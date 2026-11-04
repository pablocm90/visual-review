import { createContext, type ReactNode, useContext, useMemo } from 'react';
import { anchorKey } from '../core/anchors.ts';
import type { ReviewNotes } from '../core/notes.ts';
import type { PreviousComment } from '../core/previous-comments.ts';
import type { Comment } from '../core/review.ts';
import type { SinceReview } from '../core/since-review.ts';
import { type PlaceOfLine, placeOfLine } from './anchors.ts';
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

type Answers = NonNullable<ReviewNotes['answers']>;

const SaidOnThisPage = createContext<{
  readonly byAnchor: ReadonlyMap<string, PreviousComment>;
  readonly compared: boolean;
  readonly answers: Answers;
}>({ byAnchor: new Map(), compared: false, answers: {} });

const ANSWER_LABELS = { done: 'Done', answered: 'Answered', declined: 'Declined' } as const;

const ClaudesAnswer = ({ answer }: { readonly answer: Answers[string] }) => (
  <div
    role="note"
    className="claudes-answer"
    aria-label={`Claude: ${ANSWER_LABELS[answer.status]}`}
  >
    <span className="draft-kind">{ANSWER_LABELS[answer.status]}</span>
    {answer.status === 'done' && (
      <>
        {' '}
        <Ref name={answer.commit} />
      </>
    )}
    <p className="last-said">{answer.text}</p>
  </div>
);

type Responding = {
  readonly resolved: ReadonlyArray<PreviousComment>;
  readonly onResolve: (comment: PreviousComment) => void;
};

const RespondingToLastSaid = createContext<Responding | undefined>(undefined);

export const RespondingOnPage = RespondingToLastSaid.Provider;

const sameAnchor = (one: PreviousComment, other: PreviousComment) =>
  anchorKey(one.anchor) === anchorKey(other.anchor);

export const withResolveToggled = (
  resolved: ReadonlyArray<PreviousComment>,
  comment: PreviousComment,
): ReadonlyArray<PreviousComment> =>
  resolved.some(each => sameAnchor(each, comment))
    ? resolved.filter(each => !sameAnchor(each, comment))
    : [...resolved, comment];

const Resolve = ({ comment }: { readonly comment: PreviousComment }) => {
  const responding = useContext(RespondingToLastSaid);
  if (responding === undefined || comment.kind === 'fine') return null;
  return (
    <button
      type="button"
      className="said-resolve"
      aria-pressed={responding.resolved.some(each => sameAnchor(each, comment))}
      onClick={() => responding.onResolve(comment)}
    >
      Resolve
    </button>
  );
};

export const Said = (said: Marked) => {
  const { kind, text, changedSince = [], anchor } = said.comment;
  const mark = markOf(said);
  const answer = useContext(SaidOnThisPage).answers[anchorKey(anchor)];
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
      {answer !== undefined && <ClaudesAnswer answer={answer} />}
      <Resolve comment={said.comment} />
    </>
  );
};

const keyOf = ({ anchor, target }: PreviousComment) =>
  anchorKey(
    (anchor.kind === 'part' || anchor.kind === 'edge') && target !== undefined
      ? { kind: anchor.kind, id: target }
      : anchor,
  );

type LastSaidOnPageProps = {
  readonly since: SinceReview | undefined;
  readonly answers: Answers | undefined;
  readonly children: ReactNode;
};

export const LastSaidOnPage = ({ since, answers, children }: LastSaidOnPageProps) => {
  const said = useMemo(
    () => ({
      byAnchor: new Map(since?.comments.map(comment => [keyOf(comment), comment])),
      compared: since !== undefined && 'changed' in since,
      answers: answers ?? {},
    }),
    [since, answers],
  );
  return <SaidOnThisPage.Provider value={said}>{children}</SaidOnThisPage.Provider>;
};

export const useHasSaid = () => {
  const { byAnchor } = useContext(SaidOnThisPage);
  return (on: Pick<Comment['anchor'], 'kind' | 'id'>): boolean => byAnchor.has(anchorKey(on));
};

export const useSaidLinesOf = (
  path: string,
): ReadonlyArray<{ readonly anchor: PreviousComment['anchor']; readonly place: PlaceOfLine }> => {
  const { byAnchor } = useContext(SaidOnThisPage);
  return [...byAnchor.values()].flatMap(({ anchor }) => {
    const place = placeOfLine(anchor);
    return place?.path === path ? [{ anchor, place }] : [];
  });
};

export const SaidBefore = ({
  on,
}: {
  readonly on: Pick<PreviousComment['anchor'], 'kind' | 'id'>;
}) => {
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
