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

export const NextToIt = ({ diff, part, read, onGoTo }: NextToItProps) => {
  const labelOf = new Map(diff.nodes.map(node => [node.id, node.label]));
  const rows = [
    ...diff.edges
      .filter(edge => edge.from === part)
      .map(edge => ({ edge, other: edge.to, does: outwards(edge) })),
    ...diff.edges
      .filter(edge => edge.to === part)
      .map(edge => ({ edge, other: edge.from, does: inwards(edge) })),
  ];
  if (rows.length === 0) return null;
  return (
    <section className="next-to-it" aria-label="Next to it">
      <h3>Next to it</h3>
      <ul>
        {rows.map(({ edge, other, does }) => (
          <li key={edgeId(edge)}>
            <button type="button" className="next-to-it-row" onClick={() => onGoTo(other)}>
              {[
                `${does} ${labelOf.get(other)}`,
                ...(edge.state === 'unchanged' ? [] : [edge.state]),
                ...(read.has(other) ? ['read'] : []),
              ].join(' · ')}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
};
