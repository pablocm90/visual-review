import type { Finding } from '../core/findings.ts';
import type { GraphNode } from '../core/graph.ts';
import type { PreviousComment } from '../core/previous-comments.ts';
import type { Comment } from '../core/review.ts';
import type { SinceReview } from '../core/since-review.ts';
import { anchorName, type PlaceOfLine, placeOfLine } from './anchors.ts';
import { COMMENT_KINDS } from './comment-field.tsx';
import { ANSWER_KINDS } from './finding-display.tsx';
import { Ref } from './ref.tsx';

const kindLabels = new Map<string, string>([...COMMENT_KINDS, ...ANSWER_KINDS]);

type Mark = 'Changed since' | 'As it was' | undefined;

const markOf = ({ changedSince }: PreviousComment, compared: boolean): Mark => {
  if (changedSince !== undefined) return 'Changed since';
  return compared ? 'As it was' : undefined;
};

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
  return {
    name: anchorName(anchor, nodes),
    onGo: target === undefined ? goOutside : () => onGoToDraft(target, anchor),
  };
};

type LastReviewProps = Going & { readonly since: SinceReview };

export const LastReview = ({ since, ...going }: LastReviewProps) => {
  if (since.body === undefined && since.comments.length === 0) return null;
  const compared = 'changed' in since;
  return (
    <section className="last-review" aria-label="Last review">
      <details open>
        <summary className="last-review-title">Last review</summary>
        {since.body !== undefined && <p className="last-review-body">{since.body}</p>}
        <ul className="last-review-list">
          {since.comments.map(comment => {
            const { anchor, kind, text, changedSince } = comment;
            const { name, onGo } = whereOf(comment, going);
            const label = kindLabels.get(kind);
            const mark = markOf(comment, compared);
            return (
              <li
                key={`${anchor.kind} ${anchor.id}`}
                className="last-comment"
                aria-label={`${name}: ${label}${mark === undefined ? '' : `, ${mark}`}`}
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
                <span className="draft-kind">{label}</span>
                {mark !== undefined && <span className="last-mark">{mark}</span>}
                {text !== undefined && <p className="last-said">{text}</p>}
                {changedSince !== undefined && changedSince.length > 0 && (
                  <ul className="last-commits">
                    {changedSince.map(({ sha, subject }) => (
                      <li key={sha}>
                        <Ref name={sha} /> <span>{subject}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </details>
    </section>
  );
};
