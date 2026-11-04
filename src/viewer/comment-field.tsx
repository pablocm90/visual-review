import { useId, useState } from 'react';
import { anchorKey } from '../core/anchors.ts';
import type { Comment } from '../core/review.ts';

export type Comments = Readonly<Record<string, Comment>>;

export const COMMENT_KINDS: ReadonlyArray<readonly [Comment['kind'], string]> = [
  ['change', 'Change this'],
  ['question', 'Question'],
  ['suggestion', 'Suggestion'],
];

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

type CommentOnProps = CommentFieldProps & {
  readonly name: string;
  readonly landing?: object | undefined;
};

export const CommentOn = ({ name, landing, ...field }: CommentOnProps) => {
  const drafted = field.comments[anchorKey(field.anchor)] !== undefined;
  const [open, setOpen] = useState(drafted);
  const [landed, setLanded] = useState(landing);
  if (landing !== landed) {
    setLanded(landing);
    if (landing !== undefined && drafted) setOpen(true);
  }
  return (
    <>
      <button
        type="button"
        className="comment-on"
        aria-expanded={open}
        aria-label={`Comment on ${name}`}
        onClick={() => setOpen(!open)}
      >
        Comment
      </button>
      {open && <CommentField {...field} />}
    </>
  );
};
