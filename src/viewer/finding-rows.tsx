import type { Finding } from '../core/findings.ts';
import {
  AnswerButtons,
  type Answers,
  type AnswerTo,
  findingLine,
  LevelMark,
} from './finding-display.tsx';
import { useRowMarks } from './what-changed.tsx';

export type FindingRowsProps = {
  readonly found: ReadonlyArray<Finding>;
  readonly answers: Answers;
  readonly onAnswer: AnswerTo | undefined;
};

export const FindingRows = ({ found, answers, onAnswer }: FindingRowsProps) => {
  const marksOf = useRowMarks();
  return (
    <ul className="note-findings" aria-label="Findings">
      {found.map(finding => (
        <li key={finding.id} {...marksOf({ kind: 'finding', id: finding.id })}>
          <LevelMark level={finding.level} />
          {findingLine(finding)}
          {onAnswer && (
            <AnswerButtons id={finding.id} answer={answers[finding.id]} onAnswer={onAnswer} />
          )}
        </li>
      ))}
    </ul>
  );
};
