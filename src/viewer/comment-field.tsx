import {
  createContext,
  type ReactNode,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
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

export const CommentAsked = createContext<
  { readonly anchor: string; readonly request: object } | undefined
>(undefined);

const useAsked = (anchor: Comment['anchor']) => {
  const asked = useContext(CommentAsked);
  return asked?.anchor === anchorKey(anchor) ? asked.request : undefined;
};

export type CommentFieldProps = {
  readonly anchor: Comment['anchor'];
  readonly comments: Comments;
  readonly onComment: (comment: Comment) => void;
};

type FocusedFieldProps = CommentFieldProps & { readonly clicked?: object | undefined };

export const CommentField = ({ anchor, comments, onComment, clicked }: FocusedFieldProps) => {
  const group = useId();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const asked = useAsked(anchor);
  useLayoutEffect(() => {
    if (clicked ?? asked) textarea.current?.focus();
  }, [clicked, asked]);
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
        <textarea
          ref={textarea}
          value={text}
          onChange={event => write({ kind, text: event.target.value })}
        />
      </label>
    </>
  );
};

type CommentOpenerProps = CommentFieldProps & {
  readonly word: ReactNode;
  readonly label?: string;
  readonly landing?: object | undefined;
  readonly className?: string;
};

export const CommentOpener = ({
  word,
  label,
  landing,
  className = '',
  ...field
}: CommentOpenerProps) => {
  const drafted = field.comments[anchorKey(field.anchor)] !== undefined;
  const [open, setOpen] = useState(drafted);
  const [landed, setLanded] = useState(landing);
  const [clicked, setClicked] = useState<object>();
  const asked = useAsked(field.anchor);
  const [answered, setAnswered] = useState(asked);
  if (asked !== answered) {
    setAnswered(asked);
    if (asked !== undefined) setOpen(true);
  }
  if (landing !== landed) {
    setLanded(landing);
    if (landing !== undefined && drafted) setOpen(true);
  }
  return (
    <>
      <button
        type="button"
        className={`comment-on ${className}`}
        aria-expanded={open}
        aria-label={label}
        onClick={() => {
          setClicked(open ? undefined : {});
          setOpen(!open);
        }}
      >
        {word}
      </button>
      {open && <CommentField {...field} clicked={clicked} />}
    </>
  );
};
