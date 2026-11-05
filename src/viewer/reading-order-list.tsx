import type { Finding } from '../core/findings.ts';
import type { PageData } from '../core/page.ts';
import { LEVELS, LevelMark, worstOf } from './finding-display.tsx';

type ReadingStopsProps = {
  readonly review: Pick<PageData, 'diff' | 'readingOrder' | 'undrawn'>;
  readonly read: ReadonlySet<string>;
  readonly current: string | undefined;
  readonly onGoTo: (id: string) => void;
  readonly onShowOutside: (opener: HTMLButtonElement) => void;
};

type ReadingOrderListProps = {
  readonly review: Pick<PageData, 'diff' | 'readingOrder' | 'undrawn'>;
  readonly findings: ReadonlyArray<Finding>;
  readonly read: ReadonlySet<string>;
  readonly commentable: boolean;
  readonly onGoTo: (id: string) => void;
  readonly onStart: () => void;
  readonly onShowOutside: (opener: HTMLButtonElement) => void;
};

type PartsRead = { readonly read: number; readonly parts: number };

export const partsRead = ({ read, parts }: PartsRead) =>
  `${read} of ${parts} ${parts === 1 ? 'part' : 'parts'} read`;

const FindingsMark = ({ findings }: { readonly findings: ReadonlyArray<Finding> }) => {
  const level = worstOf(findings);
  const count = `${findings.length} ${findings.length === 1 ? 'finding' : 'findings'}`;
  return (
    <span className="reading-findings" role="img" aria-label={`${LEVELS[level]}, ${count}`}>
      <LevelMark level={level} /> {findings.length}
    </span>
  );
};

type StopProps = {
  readonly number: number;
  readonly label: string | undefined;
  readonly read: boolean;
  readonly current: boolean;
  readonly onClick: (opener: HTMLButtonElement) => void;
};

const Stop = ({ number, label, read, current, onClick }: StopProps) => (
  <li className="reading-stop">
    <button
      type="button"
      className="reading-stop-button"
      title={label}
      aria-current={current ? 'step' : undefined}
      onClick={event => onClick(event.currentTarget)}
    >
      <span className="reading-number">{number}</span>{' '}
      <span className="visually-hidden">{label}</span>
    </button>
    {read && (
      <span className="reading-read" role="img" aria-label="read">
        ✓
      </span>
    )}
  </li>
);

export const ReadingStops = ({
  review,
  read,
  current,
  onGoTo,
  onShowOutside,
}: ReadingStopsProps) => {
  const labelOf = new Map(review.diff.nodes.map(node => [node.id, node.label]));
  const { parts } = review.readingOrder;
  return (
    <nav className="reading-stops" aria-label="Reading order">
      <ol>
        {parts.map((part, index) => (
          <Stop
            key={part}
            number={index + 1}
            label={labelOf.get(part)}
            read={read.has(part)}
            current={part === current}
            onClick={() => onGoTo(part)}
          />
        ))}
        {review.undrawn.map(({ path }, index) => (
          <Stop
            key={path}
            number={parts.length + index + 1}
            label={path}
            read={false}
            current={false}
            onClick={onShowOutside}
          />
        ))}
      </ol>
    </nav>
  );
};

export const ReadingOrderList = ({
  review,
  findings,
  read,
  commentable,
  onGoTo,
  onStart,
  onShowOutside,
}: ReadingOrderListProps) => {
  if (review.readingOrder.parts.length === 0 && review.undrawn.length === 0) return null;
  const labelOf = new Map(review.diff.nodes.map(node => [node.id, node.label]));
  const findingsOn = Map.groupBy(findings, finding => finding.target);
  const cycleFrom = new Map(review.readingOrder.cycles.map(cycle => [cycle[0], cycle.length]));
  return (
    <nav className="reading-order" aria-label="Reading order">
      <h2 className="reading-order-title">Reading order</h2>
      {review.readingOrder.parts.length > 0 && (
        <>
          <button type="button" className="start-reading" onClick={onStart}>
            Start reading
          </button>
          <p className="reading-keys">
            <kbd>J</kbd> / <kbd>K</kbd> next or previous, <kbd>A</kbd> mark read
            {commentable && (
              <>
                , <kbd>C</kbd> comment
              </>
            )}
          </p>
        </>
      )}
      <ol className="reading-order-list">
        {review.readingOrder.parts.map((part, index) => {
          const found = findingsOn.get(part);
          const cycle = cycleFrom.get(part);
          return (
            <li key={part} className="reading-order-row">
              <button type="button" className="reading-order-part" onClick={() => onGoTo(part)}>
                <span className="reading-number">{index + 1}</span> {labelOf.get(part)}
              </button>
              {read.has(part) && (
                <span className="reading-read" role="img" aria-label="read">
                  ✓
                </span>
              )}
              {found && <FindingsMark findings={found} />}
              {cycle !== undefined && (
                <p className="reading-cycle">
                  {cycle} parts depend on each other: read in name order
                </p>
              )}
            </li>
          );
        })}
      </ol>
      {review.undrawn.length > 0 && (
        <>
          <h3 className="reading-order-subtitle">Outside the graph</h3>
          <ol className="reading-order-list">
            {review.undrawn.map(({ path }, index) => (
              <li key={path} className="reading-order-row">
                <button
                  type="button"
                  className="reading-order-part"
                  onClick={event => onShowOutside(event.currentTarget)}
                >
                  <span className="reading-number">
                    {review.readingOrder.parts.length + index + 1}
                  </span>{' '}
                  {path}
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
    </nav>
  );
};
