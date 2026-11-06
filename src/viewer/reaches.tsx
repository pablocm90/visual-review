import type { DiffedNode } from '../core/diff-graphs.ts';
import { counted } from '../core/findings.ts';
import type { Reach, ReachingUse } from '../core/read-reaches.ts';

type ReachesProps = {
  readonly reaches: ReadonlyArray<Reach>;
  readonly nodes: ReadonlyArray<DiffedNode>;
  readonly onGoTo: (id: string) => void;
};

const UseLine = ({ path, line, text }: ReachingUse) => (
  <>
    <span className="reach-place">
      {path}:{line}
    </span>
    <code>{text}</code>
  </>
);

export const Reaches = ({ reaches, nodes, onGoTo }: ReachesProps) => {
  const files = new Set(reaches.flatMap(({ uses }) => uses.map(({ path }) => path)));
  const nodeAt = (path: string) => nodes.find(node => node.path === path);
  return (
    <section className="column-section reaches" aria-label="Reaches">
      <h3>Reaches {counted(files.size, 'unchanged file', 'unchanged files')}</h3>
      {reaches.map(({ id, uses }) => (
        <ul key={id} className="reach-uses">
          {uses.map(use => {
            const at = nodeAt(use.path);
            return (
              <li key={`${use.path}:${use.line}`}>
                {at === undefined ? (
                  <UseLine {...use} />
                ) : (
                  <button type="button" className="reach-go" onClick={() => onGoTo(at.id)}>
                    <UseLine {...use} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ))}
    </section>
  );
};
