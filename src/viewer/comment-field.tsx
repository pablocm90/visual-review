import { useId } from 'react';
import type { Comment } from '../core/review.ts';
import { anchorKey } from './anchors.ts';
import { COMMENT_KINDS, type Comments } from './review-tray.tsx';

type Draft = Pick<Comment, 'kind' | 'text'>;

const NO_DRAFT: Draft = { kind: 'question', text: '' };

type CommentFieldProps = {
  readonly anchor: Comment['anchor'];
  readonly comments: Comments;
  readonly onComment: (comment: Comment) => void;
};

export const CommentField = ({ anchor, comments, onComment }: CommentFieldProps) => {
  const group = useId();
  const { kind, text } = comments[anchorKey(anchor)] ?? NO_DRAFT;
  const write = (draft: Draft) => onComment({ anchor, ...draft });
  return (
    <>
      <div role="radiogroup" aria-label="Comment kind" className="comment-kind">
        {COMMENT_KINDS.map(([option, label]) => (
          <label key={option}>
            <input
              type="radio"
              name={group}
              checked={kind === option}
              onChange={() => write({ kind: option, text })}
            />
            {label}
          </label>
        ))}
      </div>
      <label className="comment">
        Your comment
        <textarea value={text} onChange={event => write({ kind, text: event.target.value })} />
      </label>
    </>
  );
};
