import type { Finding } from '../core/findings.ts';
import type { GraphNode } from '../core/graph.ts';
import type { ReviewNotes } from '../core/notes.ts';
import type { PreviousComment } from '../core/previous-comments.ts';
import type { Comment } from '../core/review.ts';
import type { SinceReview } from '../core/since-review.ts';
import { anchorName, type PlaceOfLine, placeOfLine } from './anchors.ts';
import { Said, saidLabel } from './said-before.tsx';

const QUIET_TITLE = 'Changed since, no comment';
const UNASKED_TITLE = 'Claude also changed';

type Going = {
  readonly nodes: ReadonlyArray<GraphNode>;
  readonly findings: ReadonlyArray<Finding>;
  readonly onGoTo: (id: string) => void;
  readonly onGoToDraft: (id: string, anchor: Comment['anchor']) => void;
  readonly onGoToOutside: (place: PlaceOfLine, opener: HTMLButtonElement) => void;
};

const whereOf = (
  { anchor, target }: PreviousComment,
  { nodes, findings, onGoTo, onGoToDraft, onGoToOutside }: Going,
) => {
  if (anchor.kind === 'finding')
    return {
      name: findings.find(({ id }) => id === anchor.id)?.title ?? anchor.id,
      onGo: target === undefined ? undefined : () => onGoTo(target),
    };
  const place = placeOfLine(anchor);
  const goOutside = place && ((opener: HTMLButtonElement) => onGoToOutside(place, opener));
  const onTheGraph = anchor.kind === 'part' || anchor.kind === 'edge';
  return {
    name: anchorName(
      onTheGraph && target !== undefined ? { ...anchor, id: target } : anchor,
      nodes,
    ),
    onGo: target === undefined ? goOutside : () => onGoToDraft(target, anchor),
  };
};

type LastReviewProps = Going & {
  readonly since: SinceReview;
  readonly unasked: ReviewNotes['unasked'];
};

export const LastReview = ({ since, unasked, ...going }: LastReviewProps) => {
  const quiet = 'changedWithoutComment' in since ? since.changedWithoutComment : [];
  const unaskedChanges = Object.entries(unasked ?? {});
  if (
    since.body === undefined &&
    since.comments.length === 0 &&
    quiet.length === 0 &&
    unaskedChanges.length === 0
  )
    return null;
  const compared = 'changed' in since;
  return (
    <section className="last-review" aria-label="Last review">
      <details open>
        <summary className="last-review-title">Last review</summary>
        {since.body !== undefined && <p className="last-review-body">{since.body}</p>}
        <ul className="last-review-list">
          {since.comments.map(comment => {
            const { anchor } = comment;
            const { name, onGo } = whereOf(comment, going);
            return (
              <li
                key={`${anchor.kind} ${anchor.id}`}
                className="last-comment"
                aria-label={`${name}: ${saidLabel({ comment, compared })}`}
              >
                {onGo === undefined ? (
                  name
                ) : (
                  <button
                    type="button"
                    className="draft-target"
                    onClick={event => onGo(event.currentTarget)}
                  >
                    {name}
                  </button>
                )}{' '}
                <Said comment={comment} compared={compared} />
              </li>
            );
          })}
        </ul>
        {quiet.length > 0 && (
          <>
            <h3 className="last-review-subtitle">{QUIET_TITLE}</h3>
            <ul aria-label={QUIET_TITLE} className="last-review-list">
              {quiet.map(id => (
                <li key={id} className="last-comment">
                  <button type="button" className="draft-target" onClick={() => going.onGoTo(id)}>
                    {anchorName({ kind: 'part', id }, going.nodes)}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {unaskedChanges.length > 0 && (
          <>
            <h3 className="last-review-subtitle">{UNASKED_TITLE}</h3>
            <ul aria-label={UNASKED_TITLE} className="last-review-list">
              {unaskedChanges.map(([id, { text }]) => {
                const name = anchorName({ kind: 'part', id }, going.nodes);
                return (
                  <li key={id} className="last-comment" aria-label={`${name}: ${text}`}>
                    <button type="button" className="draft-target" onClick={() => going.onGoTo(id)}>
                      {name}
                    </button>
                    <p className="last-said">{text}</p>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </details>
    </section>
  );
};
