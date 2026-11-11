import { edgeId } from '../core/graph.ts';
import type { PageData } from '../core/page.ts';

type NextToItProps = {
  readonly diff: PageData['diff'];
  readonly part: string;
  readonly read: ReadonlySet<string>;
  readonly onGoTo: (id: string) => void;
};

type Edge = PageData['diff']['edges'][number];

const outwards = (edge: Edge) => (edge.via ? 'calls' : 'imports');
const inwards = (edge: Edge) => (edge.via ? 'called by' : 'imported by');

type Row = { readonly edge: Edge; readonly other: string; readonly does: string };

export const NextToIt = ({ diff, part, read, onGoTo }: NextToItProps) => {
  const labelOf = new Map(diff.nodes.map(node => [node.id, node.label]));
  const stateOf = new Map(diff.nodes.map(node => [node.id, node.state]));
  const rows: ReadonlyArray<Row> = [
    ...diff.edges
      .filter(edge => edge.from === part)
      .map(edge => ({ edge, other: edge.to, does: outwards(edge) })),
    ...diff.edges
      .filter(edge => edge.to === part)
      .map(edge => ({ edge, other: edge.from, does: inwards(edge) })),
  ];
  if (rows.length === 0) return null;
  const isNews = ({ edge, other }: Row) =>
    edge.state !== 'unchanged' || (stateOf.get(other) ?? 'unchanged') !== 'unchanged';
  const rowOf = ({ edge, other, does }: Row) => (
    <li key={edgeId(edge)}>
      <button type="button" className="next-to-it-row" onClick={() => onGoTo(other)}>
        {[
          `${does} ${labelOf.get(other)}`,
          ...(edge.state === 'unchanged' ? [] : [edge.state]),
          ...(read.has(other) ? ['read'] : []),
        ].join(' · ')}
      </button>
    </li>
  );
  const news = rows.filter(isNews);
  const quiet = rows.filter(row => !isNews(row));
  return (
    <section className="next-to-it" aria-label="Next to it">
      <h3>Next to it</h3>
      {news.length > 0 && <ul>{news.map(rowOf)}</ul>}
      {quiet.length > 0 && (
        <details className="next-to-it-quiet" open={news.length === 0 && quiet.length <= 5}>
          <summary>
            {news.length > 0 ? `and ${quiet.length} unchanged` : `${quiet.length} unchanged`}
          </summary>
          <ul>{quiet.map(rowOf)}</ul>
        </details>
      )}
    </section>
  );
};
