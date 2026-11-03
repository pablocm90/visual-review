import type { Finding } from '../core/findings.ts';
import type { PageData } from '../core/page.ts';
import { LEVELS, LevelMark, worstOf } from './finding-display.tsx';

type ReadingOrderListProps = {
  readonly review: Pick<PageData, 'diff' | 'readingOrder' | 'undrawn'>;
  readonly findings: ReadonlyArray<Finding>;
  readonly read: ReadonlySet<string>;
  readonly onGoTo: (id: string) => void;
  readonly onShowOutside: (opener: HTMLButtonElement) => void;
};

const FindingsMark = ({ findings }: { readonly findings: ReadonlyArray<Finding> }) => {
  const level = worstOf(findings);
  const count = `${findings.length} ${findings.length === 1 ? 'finding' : 'findings'}`;
  return (
    <span className="reading-findings" role="img" aria-label={`${LEVELS[level]}, ${count}`}>
      <LevelMark level={level} /> {findings.length}
    </span>
  );
};

export const ReadingOrderList = ({
  review,
  findings,
  read,
  onGoTo,
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
          <p className="reading-progress">
            {review.readingOrder.parts.filter(part => read.has(part)).length} of{' '}
            {review.readingOrder.parts.length}{' '}
            {review.readingOrder.parts.length === 1 ? 'part' : 'parts'} read
          </p>
          <p className="reading-keys">
            <kbd>J</kbd> / <kbd>K</kbd> next or previous, <kbd>A</kbd> mark read
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
