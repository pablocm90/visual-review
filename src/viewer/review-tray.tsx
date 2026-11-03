import { useState } from 'react';
import type { Answer, Comment, Review } from '../core/review.ts';

import type { Answers } from './finding-display.tsx';
import { partsRead } from './reading-order-list.tsx';

type Drafted = Review['comments'][number];

export type Comments = Readonly<Record<string, Comment>>;

type ReviewTrayProps = {
  readonly reviewed: Review['reviewed'];
  readonly read: Review['read'];
  readonly parts: ReadonlyArray<string>;
  readonly comments: Comments;
  readonly answers: Answers;
  readonly nameOf: (id: string) => string;
  readonly onGoTo: (id: string) => void;
  readonly send: (review: Review) => Promise<void>;
};

const VERDICTS: ReadonlyArray<readonly [Review['verdict'], string]> = [
  ['approve', 'Approve'],
  ['comment', 'Comment'],
  ['request-changes', 'Request changes'],
];

export const COMMENT_KINDS: ReadonlyArray<readonly [Comment['kind'], string]> = [
  ['change', 'Change this'],
  ['question', 'Question'],
  ['suggestion', 'Suggestion'],
];

const kindLabels = new Map(COMMENT_KINDS);

const counted = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

const draftedLine = (written: ReadonlyArray<Drafted>) =>
  written.length === 0
    ? 'Nothing drafted'
    : [
        `${written.length} drafted`,
        ...COMMENT_KINDS.flatMap(([kind]) => {
          const count = written.filter(comment => comment.kind === kind).length;
          return count === 0 ? [] : [counted(count, kind)];
        }),
      ].join(' · ');

const suggestedFor = (written: ReadonlyArray<Drafted>): Review['verdict'] => {
  if (written.some(({ kind }) => kind === 'change' || kind === 'fix')) return 'request-changes';
  if (written.some(({ kind }) => kind === 'question' || kind === 'explain')) return 'comment';
  return 'approve';
};

const inReadingOrder = (written: ReadonlyArray<Comment>, parts: ReadonlyArray<string>) => {
  const rank = ({ anchor }: Comment) => {
    const at = parts.indexOf(anchor.id);
    return at === -1 ? parts.length : at;
  };
  return written.toSorted(
    (one, other) => rank(one) - rank(other) || one.anchor.id.localeCompare(other.anchor.id),
  );
};

const withWhy = ({ text, ...answer }: Answer): Answer =>
  text?.trim() ? { ...answer, text } : answer;

export const ReviewTray = ({
  reviewed,
  read,
  parts,
  comments,
  answers,
  nameOf,
  onGoTo,
  send,
}: ReviewTrayProps) => {
  const [picked, setPicked] = useState<Review['verdict']>();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [sent, setSent] = useState(false);
  const [problem, setProblem] = useState<string>();
  const drafted = Object.values(comments).filter(({ text }) => text.trim() !== '');
  const written = [...drafted, ...Object.values(answers).map(withWhy)];
  const hasBody = body.trim() !== '';
  const suggested = suggestedFor(written);
  const verdict = picked ?? suggested;
  const sendComments = () =>
    send({
      version: 4,
      verdict,
      ...(hasBody ? { body } : {}),
      reviewed,
      read,
      comments: written,
    }).then(
      () => setSent(true),
      (error: Error) => setProblem(error.message),
    );
  return (
    <section className="send-review" aria-label="Review tray">
      {sent ? (
        <p role="status" aria-label="Review">
          Sent
        </p>
      ) : (
        <>
          <p>{draftedLine(written)}</p>
          <button
            type="button"
            aria-expanded={open}
            aria-controls="review-panel"
            onClick={() => setOpen(wasOpen => !wasOpen)}
          >
            Review
          </button>
          {open && (
            <div id="review-panel" className="review-panel" role="group" aria-label="Review">
              {problem && (
                <p role="status" aria-label="Review" className="send-problem">
                  {problem}
                </p>
              )}
              <label className="general-comment">
                General comment
                <textarea value={body} onChange={event => setBody(event.target.value)} />
              </label>
              <ul aria-label="Drafts">
                {inReadingOrder(drafted, parts).map(({ anchor, kind, text }) => (
                  <li key={anchor.id}>
                    <button type="button" onClick={() => onGoTo(anchor.id)}>
                      {nameOf(anchor.id)}
                    </button>{' '}
                    {kindLabels.get(kind)}: {text}
                  </li>
                ))}
              </ul>
              {parts.length > 0 && <p>{partsRead({ read: read.length, parts: parts.length })}</p>}
              <ul aria-label="Read, nothing to say">
                {read
                  .filter(part => !written.some(({ anchor }) => anchor.id === part))
                  .map(part => (
                    <li key={part}>{nameOf(part)}</li>
                  ))}
              </ul>
              <div role="radiogroup" aria-label="Verdict" className="verdict">
                {VERDICTS.map(([value, label]) => (
                  <div key={value} className="verdict-option">
                    <label>
                      <input
                        type="radio"
                        name="verdict"
                        checked={verdict === value}
                        onChange={() => setPicked(value)}
                        aria-describedby={value === suggested ? 'suggested-verdict' : undefined}
                      />
                      {label}
                    </label>
                    {value === suggested && (
                      <span id="suggested-verdict" className="suggested">
                        suggested
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <button
                type="button"
                disabled={verdict !== 'approve' && written.length === 0 && !hasBody}
                onClick={sendComments}
              >
                Send to Claude
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
};
