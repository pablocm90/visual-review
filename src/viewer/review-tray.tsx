import { useState } from 'react';
import type { Finding } from '../core/findings.ts';
import type { Answer, Comment, Review } from '../core/review.ts';

import { ANSWER_KINDS, type Answers } from './finding-display.tsx';
import { partsRead } from './reading-order-list.tsx';

type Drafted = Review['comments'][number];

export type Comments = Readonly<Record<string, Comment>>;

type ReviewTrayProps = {
  readonly reviewed: Review['reviewed'];
  readonly read: Review['read'];
  readonly parts: ReadonlyArray<string>;
  readonly comments: Comments;
  readonly answers: Answers;
  readonly findings: ReadonlyArray<Finding>;
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

const answerLabels = new Map(ANSWER_KINDS);

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

type PreviewOf = {
  readonly verdict: Review['verdict'];
  readonly read: Review['read'];
  readonly parts: ReadonlyArray<string>;
  readonly listed: ReadonlyArray<Drafted>;
  readonly silent: ReadonlyArray<string>;
};

const previewOf = ({ verdict, read, parts, listed, silent }: PreviewOf) => [
  [verdict, ...(parts.length > 0 ? [`read ${read.length} of ${parts.length}`] : [])].join(' · '),
  ...listed.map(({ kind, anchor }) => `${kind.padEnd(10)}${anchor.id}`),
  ...(silent.length > 0
    ? [`${'read'.padEnd(10)}${counted(silent.length, 'part')}, no comment`]
    : []),
];

type DraftProps = {
  readonly name: string;
  readonly onGo: (() => void) | undefined;
  readonly label: string | undefined;
  readonly text: string | undefined;
};

const Draft = ({ name, onGo, label, text }: DraftProps) => (
  <li className="draft">
    {onGo === undefined ? (
      name
    ) : (
      <button type="button" className="draft-target" onClick={onGo}>
        {name}
      </button>
    )}{' '}
    <span className="draft-kind">
      {label}
      {text === undefined ? '' : ':'}
    </span>
    {text === undefined ? '' : ` ${text}`}
  </li>
);

type DraftListProps = {
  readonly drafted: ReadonlyArray<Comment>;
  readonly answered: ReadonlyArray<Answer>;
  readonly findings: ReadonlyArray<Finding>;
  readonly nameOf: (id: string) => string;
  readonly onGoTo: (id: string) => void;
};

const DraftList = ({ drafted, answered, findings, nameOf, onGoTo }: DraftListProps) => (
  <ul aria-label="Drafts" className="tray-list">
    {drafted.map(({ anchor, kind, text }) => (
      <Draft
        key={anchor.id}
        name={nameOf(anchor.id)}
        onGo={() => onGoTo(anchor.id)}
        label={kindLabels.get(kind)}
        text={text}
      />
    ))}
    {answered.flatMap(({ anchor, kind, text }) =>
      findings
        .filter(finding => finding.id === anchor.id)
        .map(({ id, title, target }) => (
          <Draft
            key={id}
            name={title}
            onGo={target === undefined ? undefined : () => onGoTo(target)}
            label={answerLabels.get(kind)}
            text={text}
          />
        )),
    )}
  </ul>
);

export const ReviewTray = ({
  reviewed,
  read,
  parts,
  comments,
  answers,
  findings,
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
  const answered = Object.values(answers).map(withWhy);
  const written = [...drafted, ...answered];
  const ordered = inReadingOrder(drafted, parts);
  const hasBody = body.trim() !== '';
  const suggested = suggestedFor(written);
  const verdict = picked ?? suggested;
  const silent = read.filter(part => !written.some(({ anchor }) => anchor.id === part));
  const preview = previewOf({ verdict, read, parts, listed: [...ordered, ...answered], silent });
  const sendComments = () =>
    send({
      version: 5,
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
    <section className="review-tray" aria-label="Review tray">
      {sent ? (
        <p role="status" aria-label="Review" className="tray-sent">
          Sent
        </p>
      ) : (
        <>
          <p className="tray-count">{draftedLine(written)}</p>
          <button
            type="button"
            className="tray-toggle"
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
              <div className="tray-summary">
                <DraftList
                  drafted={ordered}
                  answered={answered}
                  findings={findings}
                  nameOf={nameOf}
                  onGoTo={onGoTo}
                />
                {parts.length > 0 && (
                  <p className="tray-read">
                    {partsRead({ read: read.length, parts: parts.length })}
                  </p>
                )}
                <ul aria-label="Read, nothing to say" className="tray-list">
                  {silent.map(part => (
                    <li key={part} className="silent-part">
                      {nameOf(part)}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="tray-verdict">
                <label className="general-comment">
                  General comment
                  <textarea value={body} onChange={event => setBody(event.target.value)} />
                </label>
                <div role="radiogroup" aria-label="Verdict" className="verdict">
                  {VERDICTS.map(([value, label]) => (
                    <div key={value} className="verdict-option">
                      <label>
                        <input
                          type="radio"
                          name="verdict"
                          checked={verdict === value}
                          onClick={() => setPicked(value)}
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
                  className="tray-send"
                  disabled={verdict !== 'approve' && written.length === 0 && !hasBody}
                  onClick={sendComments}
                >
                  Send to Claude
                </button>
              </div>
              <details className="claude-gets">
                <summary>What Claude gets</summary>
                <figure aria-label="What Claude gets">
                  <pre>{preview.join('\n')}</pre>
                </figure>
              </details>
            </div>
          )}
        </>
      )}
    </section>
  );
};
