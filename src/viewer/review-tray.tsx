import { useState } from 'react';
import { anchorKey, anchorTarget, type TargetsOf } from '../core/anchors.ts';
import type { Finding } from '../core/findings.ts';
import type { GraphNode } from '../core/graph.ts';
import type { PreviousComment } from '../core/previous-comments.ts';
import type { Answer, Comment, Review } from '../core/review.ts';
import { anchorName, type PlaceOfLine, placeOfLine } from './anchors.ts';
import { COMMENT_KINDS, type Comments } from './comment-field.tsx';
import { ANSWER_KINDS, type Answers } from './finding-display.tsx';
import { whereOf } from './last-review.tsx';
import { partsRead } from './reading-order-list.tsx';

type Drafted = Review['comments'][number];

type Nodes = ReadonlyArray<Pick<GraphNode, 'id' | 'label' | 'path'>>;

type ReviewTrayProps = {
  readonly reviewed: Review['reviewed'];
  readonly read: Review['read'];
  readonly resolved: ReadonlyArray<PreviousComment>;
  readonly parts: ReadonlyArray<string>;
  readonly comments: Comments;
  readonly answers: Answers;
  readonly findings: ReadonlyArray<Finding>;
  readonly nodes: Nodes;
  readonly tests: TargetsOf['tests'];
  readonly onGoTo: (id: string) => void;
  readonly onGoToDraft: (id: string, anchor: Comment['anchor']) => void;
  readonly onGoToOutside: (place: PlaceOfLine, opener: HTMLButtonElement) => void;
  readonly onGoToFile: (path: string, opener: HTMLButtonElement) => void;
  readonly send: (review: Review) => Promise<void>;
};

const VERDICTS: ReadonlyArray<readonly [Review['verdict'], string]> = [
  ['approve', 'Approve'],
  ['comment', 'Comment'],
  ['request-changes', 'Request changes'],
];

export const verdictLabels = new Map(VERDICTS);

const kindLabels = new Map(COMMENT_KINDS);

const answerLabels = new Map(ANSWER_KINDS);

const counted = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

const draftedLine = (written: ReadonlyArray<Drafted>, resolved: number) =>
  [
    ...(written.length === 0
      ? ['Nothing drafted']
      : [
          `${written.length} drafted`,
          ...COMMENT_KINDS.flatMap(([kind]) => {
            const count = written.filter(comment => comment.kind === kind).length;
            return count === 0 ? [] : [counted(count, kind)];
          }),
        ]),
    ...(resolved === 0 ? [] : [`${resolved} resolved`]),
  ].join(' · ');

const suggestedFor = (written: ReadonlyArray<Drafted>): Review['verdict'] => {
  if (written.some(({ kind }) => kind === 'change' || kind === 'fix')) return 'request-changes';
  if (written.some(({ kind }) => kind === 'question' || kind === 'explain')) return 'comment';
  return 'approve';
};

type TargetOf = (anchor: Comment['anchor']) => string | undefined;

type InReadingOrder = {
  readonly written: ReadonlyArray<Comment>;
  readonly parts: ReadonlyArray<string>;
  readonly targetOf: TargetOf;
};

const inReadingOrder = ({ written, parts, targetOf }: InReadingOrder) => {
  const rank = ({ anchor }: Comment) => {
    const at = parts.indexOf(targetOf(anchor) ?? '');
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
  readonly ordered: ReadonlyArray<Comment>;
  readonly answered: ReadonlyArray<Answer>;
  readonly closed: ReadonlyArray<string>;
  readonly silent: ReadonlyArray<string>;
  readonly nodes: Nodes;
};

const previewOf = ({
  verdict,
  read,
  parts,
  ordered,
  answered,
  closed,
  silent,
  nodes,
}: PreviewOf) => [
  [verdict, ...(parts.length > 0 ? [`read ${read.length} of ${parts.length}`] : [])].join(' · '),
  ...ordered.map(({ kind, anchor }) => `${kind.padEnd(10)}${anchorName(anchor, nodes)}`),
  ...answered.map(({ kind, anchor }) => `${kind.padEnd(10)}${anchor.id}`),
  ...closed.map(name => `${'resolved'.padEnd(10)}${name}`),
  ...(silent.length > 0
    ? [`${'read'.padEnd(10)}${counted(silent.length, 'part')}, no comment`]
    : []),
];

type DraftProps = {
  readonly name: string;
  readonly onGo: ((opener: HTMLButtonElement) => void) | undefined;
  readonly label: string | undefined;
  readonly text: string | undefined;
};

const Draft = ({ name, onGo, label, text }: DraftProps) => (
  <li className="draft">
    {onGo === undefined ? (
      name
    ) : (
      <button type="button" className="draft-target" onClick={event => onGo(event.currentTarget)}>
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
  readonly nodes: Nodes;
  readonly targetOf: TargetOf;
  readonly onGoTo: (id: string) => void;
  readonly onGoToDraft: (id: string, anchor: Comment['anchor']) => void;
  readonly onGoToOutside: (place: PlaceOfLine, opener: HTMLButtonElement) => void;
  readonly onGoToFile: (path: string, opener: HTMLButtonElement) => void;
};

const DraftList = ({
  drafted,
  answered,
  findings,
  nodes,
  targetOf,
  onGoTo,
  onGoToDraft,
  onGoToOutside,
  onGoToFile,
}: DraftListProps) => (
  <ul aria-label="Drafts" className="tray-list">
    {drafted.map(({ anchor, kind, text }) => {
      const target = targetOf(anchor);
      const place = placeOfLine(anchor);
      const goOutside = place && ((opener: HTMLButtonElement) => onGoToOutside(place, opener));
      return (
        <Draft
          key={anchorKey(anchor)}
          name={anchorName(anchor, nodes)}
          onGo={target === undefined ? goOutside : () => onGoToDraft(target, anchor)}
          label={kindLabels.get(kind)}
          text={text}
        />
      );
    })}
    {answered.flatMap(({ anchor, kind, text }) =>
      findings
        .filter(finding => finding.id === anchor.id)
        .map(({ id, title, target, file }) => (
          <Draft
            key={id}
            name={title}
            onGo={
              target !== undefined
                ? () => onGoTo(target)
                : file !== undefined
                  ? opener => onGoToFile(file, opener)
                  : undefined
            }
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
  resolved,
  parts,
  comments,
  answers,
  findings,
  nodes,
  tests,
  onGoTo,
  onGoToDraft,
  onGoToOutside,
  onGoToFile,
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
  const targetOf: TargetOf = anchor => anchorTarget(anchor, { nodes, tests });
  const ordered = inReadingOrder({ written: drafted, parts, targetOf });
  const hasBody = body.trim() !== '';
  const suggested = suggestedFor(written);
  const verdict = picked ?? suggested;
  const commentedOn = new Set(drafted.map(({ anchor }) => targetOf(anchor)));
  const silent = read.filter(part => !commentedOn.has(part));
  const going = { nodes, findings, onGoTo, onGoToDraft, onGoToOutside };
  const closed = resolved.map(comment => ({ comment, ...whereOf(comment, going) }));
  const preview = previewOf({
    verdict,
    read,
    parts,
    ordered,
    answered,
    closed: closed.map(({ name }) => name),
    silent,
    nodes,
  });
  const sendComments = () =>
    send({
      version: 6,
      verdict,
      ...(hasBody ? { body } : {}),
      reviewed,
      read,
      resolved: resolved.map(({ anchor }) => anchor),
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
          <p className="tray-count">{draftedLine(written, resolved.length)}</p>
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
                  nodes={nodes}
                  targetOf={targetOf}
                  onGoTo={onGoTo}
                  onGoToDraft={onGoToDraft}
                  onGoToOutside={onGoToOutside}
                  onGoToFile={onGoToFile}
                />
                <ul aria-label="Resolved" className="tray-list">
                  {closed.map(({ comment: { anchor }, name, onGo }) => (
                    <Draft
                      key={anchorKey(anchor)}
                      name={name}
                      onGo={onGo}
                      label="Resolved"
                      text={undefined}
                    />
                  ))}
                </ul>
                {parts.length > 0 && (
                  <p className="tray-read">
                    {partsRead({ read: read.length, parts: parts.length })}
                  </p>
                )}
                <ul aria-label="Read, nothing to say" className="tray-list">
                  {silent.map(part => (
                    <li key={part} className="silent-part">
                      {anchorName({ kind: 'part', id: part }, nodes)}
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
