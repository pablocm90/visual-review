import { useId, useState } from 'react';
import type { Comment } from '../core/review.ts';

export type Draft = Pick<Comment, 'kind' | 'text'>;

export const NO_DRAFT: Draft = { kind: 'question', text: '' };

const COMMENT_KINDS: ReadonlyArray<readonly [Comment['kind'], string]> = [
  ['change', 'Change this'],
  ['question', 'Question'],
  ['suggestion', 'Suggestion'],
];

type CommentFormProps = {
  readonly draft: Draft;
  readonly onDraft: (draft: Draft) => void;
};

export const CommentForm = ({ draft, onDraft }: CommentFormProps) => {
  const group = useId();
  return (
    <>
      <div role="radiogroup" aria-label="Comment kind" className="comment-kind">
        {COMMENT_KINDS.map(([kind, label]) => (
          <label key={kind}>
            <input
              type="radio"
              name={group}
              checked={draft.kind === kind}
              onChange={() => onDraft({ ...draft, kind })}
            />
            {label}
          </label>
        ))}
      </div>
      <label className="comment">
        Your comment
        <textarea
          value={draft.text}
          onChange={event => onDraft({ ...draft, text: event.target.value })}
        />
      </label>
    </>
  );
};

export type Drafting = {
  readonly draftOn: (id: string) => Draft;
  readonly onDraft: (comment: Comment) => void;
};

type AnchoredCommentProps = {
  readonly anchor: Comment['anchor'];
  readonly drafting: Drafting;
};

export const AnchoredComment = ({ anchor, drafting }: AnchoredCommentProps) => {
  const [open, setOpen] = useState(false);
  return open ? (
    <CommentForm
      draft={drafting.draftOn(anchor.id)}
      onDraft={draft => drafting.onDraft({ anchor, ...draft })}
    />
  ) : (
    <button type="button" onClick={() => setOpen(true)}>
      Comment
    </button>
  );
};
