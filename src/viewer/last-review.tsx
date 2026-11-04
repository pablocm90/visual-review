import type { GraphNode } from '../core/graph.ts';
import type { PreviousComment } from '../core/previous-comments.ts';
import type { Comment } from '../core/review.ts';
import type { SinceReview } from '../core/since-review.ts';
import { anchorName } from './anchors.ts';
import { COMMENT_KINDS } from './comment-field.tsx';
import { Ref } from './ref.tsx';

const kindLabels = new Map<string, string>([...COMMENT_KINDS]);

type Mark = 'Changed since' | 'As it was' | undefined;

const markOf = ({ changedSince }: PreviousComment, compared: boolean): Mark => {
  if (changedSince !== undefined) return 'Changed since';
  return compared ? 'As it was' : undefined;
};

type LastReviewProps = {
  readonly since: SinceReview;
  readonly nodes: ReadonlyArray<GraphNode>;
  readonly onGoToDraft: (id: string, anchor: Comment['anchor']) => void;
};

export const LastReview = ({ since, nodes, onGoToDraft }: LastReviewProps) => {
  const compared = 'changed' in since;
  return (
    <section className="last-review" aria-label="Last review">
      <details open>
        <summary className="last-review-title">Last review</summary>
        {since.body !== undefined && <p className="last-review-body">{since.body}</p>}
        <ul className="last-review-list">
          {since.comments.map(comment => {
            const { anchor, kind, text, target, changedSince } = comment;
            if (anchor.kind === 'finding') return null;
            const name = anchorName(anchor, nodes);
            const label = kindLabels.get(kind);
            const mark = markOf(comment, compared);
            return (
              <li
                key={`${anchor.kind} ${anchor.id}`}
                className="last-comment"
                aria-label={`${name}: ${label}${mark === undefined ? '' : `, ${mark}`}`}
              >
                {target === undefined ? (
                  name
                ) : (
                  <button
                    type="button"
                    className="draft-target"
                    onClick={() => onGoToDraft(target, anchor)}
                  >
                    {name}
                  </button>
                )}{' '}
                <span className="draft-kind">{label}</span>
                {mark !== undefined && <span className="last-mark">{mark}</span>}
                <p className="last-said">{text}</p>
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
