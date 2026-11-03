import type { PageData } from '../core/page.ts';

type ReadingOrderListProps = {
  readonly review: Pick<PageData, 'diff' | 'readingOrder'>;
  readonly onGoTo: (id: string) => void;
};

export const ReadingOrderList = ({ review, onGoTo }: ReadingOrderListProps) => {
  const labelOf = new Map(review.diff.nodes.map(node => [node.id, node.label]));
  return (
    <nav className="reading-order" aria-label="Reading order">
      <h2 className="reading-order-title">Reading order</h2>
      <ol className="reading-order-list">
        {review.readingOrder.parts.map((part, index) => (
          <li key={part}>
            <button type="button" className="reading-order-part" onClick={() => onGoTo(part)}>
              <span className="reading-number">{index + 1}</span> {labelOf.get(part)}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
};
