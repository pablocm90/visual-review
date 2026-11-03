import type { Finding } from '../core/findings.ts';
import type { MetricFinding } from '../core/metric-findings.ts';
import { tenths } from '../core/metrics.ts';
import type { Answer } from '../core/review.ts';

export const signed = (value: number) => {
  const by = tenths(value);
  if (by > 0) return `+${by}`;
  return by < 0 ? `−${-by}` : '±0';
};

export const LEVELS: Readonly<Record<MetricFinding['level'], string>> = {
  look: 'needs a look',
  info: 'for information',
};

export const LevelMark = ({ level }: { readonly level: MetricFinding['level'] }) => (
  <svg className="level-mark" viewBox="0 0 16 16" role="img" aria-label={LEVELS[level]}>
    {level === 'look' ? <path d="M8 2 L14.5 13.5 H1.5 Z" /> : <circle cx={8} cy={8} r={6} />}
  </svg>
);

export const worstOf = (findings: ReadonlyArray<Finding>) =>
  findings.some(finding => finding.level === 'look') ? 'look' : 'info';

export const findingLine = ({ title, detail }: Finding) =>
  detail === undefined ? title : `${title}: ${detail}`;

export type Answers = Readonly<Record<string, Answer>>;

export type AnswerTo = (id: string, answer: Answer | undefined) => void;

const ANSWER_KINDS: ReadonlyArray<readonly [Answer['kind'], string]> = [
  ['fix', 'Fix this'],
  ['fine', "It's fine"],
  ['explain', 'Explain'],
];

type AnswerButtonsProps = {
  readonly id: string;
  readonly answer: Answer | undefined;
  readonly onAnswer: AnswerTo;
};

export const AnswerButtons = ({ id, answer, onAnswer }: AnswerButtonsProps) => (
  <div role="group" aria-label="Answer" className="finding-answer">
    {ANSWER_KINDS.map(([kind, label]) => (
      <button
        key={kind}
        type="button"
        className="answer-kind"
        aria-pressed={answer?.kind === kind}
        onClick={() =>
          onAnswer(
            id,
            answer?.kind === kind ? undefined : { anchor: { kind: 'finding', id }, kind },
          )
        }
      >
        {label}
      </button>
    ))}
    {answer?.kind === 'fine' && (
      <input
        aria-label="Why it's fine"
        placeholder="Why it's fine (optional)"
        value={answer.text ?? ''}
        onChange={event => onAnswer(id, { ...answer, text: event.target.value })}
      />
    )}
  </div>
);
