import type { DiffedNode } from '../core/diff-graphs.ts';
import { counted } from '../core/findings.ts';
import { reachFindingId } from '../core/reach-findings.ts';
import type { Reach, ReachingUse } from '../core/read-reaches.ts';
import { FindingRows, type FindingRowsProps } from './finding-rows.tsx';

type ReachesProps = FindingRowsProps & {
  readonly reaches: ReadonlyArray<Reach>;
  readonly nodes: ReadonlyArray<DiffedNode>;
  readonly onGoTo: (id: string) => void;
};

const UseLine = ({ path, line, text, test, unfollowed }: ReachingUse) => (
  <>
    <span className="reach-place">
      {path}:{line}
    </span>
    <code>{text}</code>
    {unfollowed && <span className="reach-mark">may use it, not followed</span>}
    {test && <span className="reach-mark">test</span>}
  </>
);

export const Reaches = ({ reaches, nodes, onGoTo, found, answers, onAnswer }: ReachesProps) => {
  const files = new Set(reaches.flatMap(({ uses }) => uses.map(({ path }) => path)));
  const nodeAt = (path: string) => nodes.find(node => node.path === path);
  return (
    <section className="column-section reaches" aria-label="Reaches">
      <h3>Reaches {counted(files.size, 'unchanged file', 'unchanged files')}</h3>
      {reaches.map(reach => {
        const itsFinding = found.filter(({ id }) => id === reachFindingId(reach));
        return (
          <div key={reach.id}>
            {itsFinding.length > 0 && (
              <FindingRows found={itsFinding} answers={answers} onAnswer={onAnswer} />
            )}
            <ul className="reach-uses">
              {reach.uses.map(use => {
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
          </div>
        );
      })}
    </section>
  );
};
