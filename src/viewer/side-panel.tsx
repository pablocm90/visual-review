import type { KeyboardEvent, PointerEvent, RefObject } from 'react';
import { anchorKey } from '../core/anchors.ts';
import { isAtOrUnder } from '../core/diff-graphs.ts';
import type { Finding } from '../core/findings.ts';
import { edgeId } from '../core/graph.ts';
import { metricFindings } from '../core/metric-findings.ts';
import type { Note } from '../core/notes.ts';
import type { PageData } from '../core/page.ts';
import { CommentAsked, useDrafting } from './comment-field.tsx';
import type { Answers, AnswerTo } from './finding-display.tsx';
import {
  type CommentAskedOn,
  type DiffNode,
  Inspector,
  type LandingIn,
  OutsideFiles,
} from './inspector.tsx';

const NOTE_WIDTH = 360;
const CHANGES_WIDTH = 600;
const PANEL_MIN = 280;
const GRAPH_MIN = 320;
const DIVIDER_AND_PADDING = 48;
const DIVIDER_STEP = 40;
const panelWidthWithin = (width: number, graphLeft: number) =>
  Math.min(
    Math.max(width, PANEL_MIN),
    window.innerWidth - graphLeft - DIVIDER_AND_PADDING - GRAPH_MIN,
  );

type SidePanelProps = {
  readonly review: PageData;
  readonly selected: string | undefined;
  readonly node: DiffNode | undefined;
  readonly outside: boolean;
  readonly note: Note | undefined;
  readonly saidInPlace: ReadonlyArray<string>;
  readonly found: ReadonlyArray<Finding>;
  readonly answers: Answers;
  readonly onAnswer: AnswerTo | undefined;
  readonly chosenWidth: number | undefined;
  readonly onChooseWidth: (width: number) => void;
  readonly graphLeft: () => number;
  readonly onCloseOutside: () => void;
  readonly onCloseInspector: (id: string) => void;
  readonly onGoTo: (id: string) => void;
  readonly onWalkTo: (id: string) => void;
  readonly onNextLogic: (() => void) | undefined;
  readonly landing: LandingIn | undefined;
  readonly onLand: (landing: LandingIn) => void;
  readonly read: ReadonlySet<string>;
  readonly onToggleRead: (id: string) => void;
  readonly commentAsked: CommentAskedOn | undefined;
  readonly onAskComment: (id: string) => void;
  readonly heading: RefObject<HTMLHeadingElement | null>;
  readonly reading: boolean;
};

export const partFrom = (
  parts: ReadonlyArray<string>,
  selected: string | undefined,
  step: number,
) => parts[Math.max(parts.indexOf(selected ?? '') + step, 0)];

export const SidePanel = ({
  review,
  selected,
  node,
  outside,
  note,
  saidInPlace,
  found,
  answers,
  onAnswer,
  chosenWidth,
  onChooseWidth,
  graphLeft,
  onCloseOutside,
  onCloseInspector,
  onGoTo,
  onWalkTo,
  onNextLogic,
  landing,
  onLand,
  read,
  onToggleRead,
  commentAsked,
  onAskComment,
  heading,
  reading,
}: SidePanelProps) => {
  const { onComment } = useDrafting();
  const patches = outside
    ? review.undrawn
    : node
      ? review.patches.filter(({ path }) => isAtOrUnder(path, node))
      : [];
  const width = chosenWidth ?? (patches.length > 0 ? CHANGES_WIDTH : NOTE_WIDTH);
  const shownWidth = reading ? undefined : width;
  const moveDivider = (event: KeyboardEvent) => {
    const step = { ArrowLeft: DIVIDER_STEP, ArrowRight: -DIVIDER_STEP }[event.key];
    if (step === undefined) return;
    onChooseWidth(panelWidthWithin(width + step, graphLeft()));
  };
  const dragDivider = (down: PointerEvent<HTMLDivElement>) => {
    down.preventDefault();
    down.currentTarget.focus();
    const follow = (move: globalThis.PointerEvent) =>
      onChooseWidth(panelWidthWithin(width + down.clientX - move.clientX, graphLeft()));
    window.addEventListener('pointermove', follow);
    window.addEventListener('pointerup', () => window.removeEventListener('pointermove', follow), {
      once: true,
    });
  };
  const divider = !reading && (
    <div
      className="divider"
      role="separator"
      aria-orientation="vertical"
      aria-label="Panel width"
      aria-valuenow={width}
      tabIndex={0}
      onKeyDown={moveDivider}
      onPointerDown={dragDivider}
    />
  );
  if (outside) {
    return (
      <>
        {divider}
        <OutsideFiles
          patches={patches}
          landing={landing}
          width={shownWidth}
          onClose={onCloseOutside}
          nodes={review.diff.nodes}
        />
      </>
    );
  }
  if (selected === undefined) return null;
  const anchor = { kind: node === undefined ? 'edge' : 'part', id: selected } as const;
  const { parts } = review.readingOrder;
  const nextId = partFrom(parts, selected, 1);
  const commentable =
    node !== undefined || review.diff.edges.some(edge => edgeId(edge) === selected);
  return (
    <CommentAsked.Provider
      value={
        commentAsked && { anchor: commentAsked.row ?? anchorKey(anchor), request: commentAsked }
      }
    >
      {divider}
      <Inspector
        heading={heading}
        nodes={review.diff.nodes}
        node={node}
        metrics={review.metrics}
        findings={metricFindings(review)}
        note={note}
        found={found}
        patches={patches}
        reviewPatches={review.patches}
        tests={review.tests}
        symbols={review.symbols}
        reaches={review.reaches}
        onGoTo={onGoTo}
        anchor={anchor}
        commentable={commentable}
        onTake={
          onComment && commentable
            ? text => {
                onComment({ anchor, kind: 'change', text });
                onAskComment(selected);
              }
            : undefined
        }
        saidInPlace={saidInPlace}
        answers={answers}
        onAnswer={onAnswer}
        width={shownWidth}
        onClose={() => onCloseInspector(selected)}
        landing={landing}
        onLand={onLand}
        walking={{
          read: parts.includes(selected) ? read.has(selected) : undefined,
          onToggleRead: () => onToggleRead(selected),
          next: review.diff.nodes.find(({ id }) => id === nextId),
          onGoTo: onWalkTo,
          onNextLogic,
        }}
      />
    </CommentAsked.Provider>
  );
};
