import { counted } from '../core/findings.ts';
import type { Reach } from '../core/read-reaches.ts';

export const Reaches = ({ reaches }: { readonly reaches: ReadonlyArray<Reach> }) => {
  const files = new Set(reaches.flatMap(({ uses }) => uses.map(({ path }) => path)));
  return (
    <section className="column-section reaches" aria-label="Reaches">
      <h3>Reaches {counted(files.size, 'unchanged file', 'unchanged files')}</h3>
      {reaches.map(({ id, uses }) => (
        <ul key={id} className="reach-uses">
          {uses.map(({ path, line, text }) => (
            <li key={`${path}:${line}`}>
              <span className="reach-place">
                {path}:{line}
              </span>
              <code>{text}</code>
            </li>
          ))}
        </ul>
      ))}
    </section>
  );
};
