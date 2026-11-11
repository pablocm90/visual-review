import type { Finding, PlaceInFile } from '../core/findings.ts';
import type { PageData } from '../core/page.ts';
import type { PreviousComment } from '../core/previous-comments.ts';
import type { Answers, AnswerTo } from './finding-display.tsx';
import { FindingsRail } from './findings-rail.tsx';
import type { LandingIn } from './inspector.tsx';
import { LastReview } from './last-review.tsx';
import { ReadingOrderList, ReadingStops } from './reading-order-list.tsx';
import type { ReviewPageProps } from './review-page.tsx';

type LeftColumnProps = {
  readonly review: PageData;
  readonly notes: ReviewPageProps['notes'];
  readonly reading: boolean;
  readonly read: ReadonlySet<string>;
  readonly selected: string | undefined;
  readonly commentable: boolean;
  readonly findings: ReadonlyArray<Finding>;
  readonly inLens: ReadonlyArray<Finding>;
  readonly railOpen: boolean;
  readonly onRailOpen: (open: boolean) => void;
  readonly answers: Answers;
  readonly onAnswer: AnswerTo | undefined;
  readonly onGoTo: (id: string) => void;
  readonly onWalkTo: (id: string) => void;
  readonly onStart: () => void;
  readonly onGoToDraft: (id: string, anchor: PreviousComment['anchor']) => void;
  readonly onGoToFinding: (id: string, finding: string) => void;
  readonly onGoToOutside: (place: LandingIn, opener: HTMLButtonElement) => void;
  readonly onShowOutside: (opener: HTMLButtonElement) => void;
  readonly onShowFile: (path: string, opener: HTMLButtonElement, place: PlaceInFile) => void;
};

export const LeftColumn = ({
  review,
  notes,
  reading,
  read,
  selected,
  commentable,
  findings,
  inLens,
  railOpen,
  onRailOpen,
  answers,
  onAnswer,
  onGoTo,
  onWalkTo,
  onStart,
  onGoToDraft,
  onGoToFinding,
  onGoToOutside,
  onShowOutside,
  onShowFile,
}: LeftColumnProps) => (
  <div className="left-column">
    {!reading && review.sinceReview !== undefined && (
      <LastReview
        since={review.sinceReview}
        unasked={notes?.unasked}
        nodes={review.diff.nodes}
        tests={review.tests}
        symbols={review.symbols}
        patches={[...review.patches, ...review.undrawn]}
        findings={findings}
        onGoTo={onGoTo}
        onGoToDraft={onGoToDraft}
        onGoToOutside={onGoToOutside}
      />
    )}
    {reading ? (
      <ReadingStops
        review={review}
        read={read}
        current={selected}
        onGoTo={onGoTo}
        onShowOutside={onShowOutside}
      />
    ) : (
      <ReadingOrderList
        review={review}
        read={read}
        commentable={commentable}
        findings={findings}
        onGoTo={onWalkTo}
        onStart={onStart}
        onShowOutside={onShowOutside}
      />
    )}
    {!reading && (
      <FindingsRail
        findings={inLens}
        open={railOpen}
        onOpen={onRailOpen}
        review={review}
        onGoTo={onGoTo}
        onGoToFinding={onGoToFinding}
        onShowOutside={onShowOutside}
        onShowFile={onShowFile}
        answers={answers}
        onAnswer={onAnswer}
      />
    )}
  </div>
);
