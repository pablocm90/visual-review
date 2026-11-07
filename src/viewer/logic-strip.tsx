import type { LogicLine } from '../core/logic-diff.ts';
import { countsOf, isExit } from '../core/logic-strip.ts';

export type StripRow = {
  readonly id: string;
  readonly line: LogicLine;
  readonly label: string;
};

export const exitsWords = (exits: number): string => {
  if (exits === 0) return '';
  return exits === 1 ? ' · 1 exit' : ` · ${exits} exits`;
};

export const LogicStrip = ({
  name,
  rows,
  marksOf,
  onTick,
}: {
  readonly name: string;
  readonly rows: ReadonlyArray<StripRow>;
  readonly marksOf: (id: string) => object;
  readonly onTick: (id: string) => void;
}) => {
  const { changed, exits } = countsOf(rows.map(({ line }) => line));
  return (
    <span className="strip-of-logic">
      <span className="strip-ticks" role="group" aria-label={`Marks of ${name}`}>
        {rows.map(({ id, line, label }) => (
          <button
            key={id}
            type="button"
            tabIndex={-1}
            className={`strip-tick tick-${line.change}${isExit(line) ? ' tick-exit' : ''}`}
            aria-label={label}
            title={label}
            {...marksOf(id)}
            onClick={() => onTick(id)}
          />
        ))}
      </span>
      <span className="strip-count">
        {changed} of {rows.length}
        {exitsWords(exits)}
      </span>
    </span>
  );
};

const LEGEND: ReadonlyArray<readonly [string, string]> = [
  ['tick-added', 'added'],
  ['tick-changed', 'changed'],
  ['tick-removed', 'removed, hangs below'],
  ['tick-moved', 'moved, unchanged'],
  ['tick-same', 'same'],
  ['tick-added tick-exit', 'taller: an exit (a guard or return)'],
];

export const LogicLegend = () => (
  <ul className="logic-legend" aria-label="Marks">
    {LEGEND.map(([mark, words]) => (
      <li key={words} className="logic-legend-entry">
        <span className={`strip-tick logic-legend-mark ${mark}`} />
        {words}
      </li>
    ))}
  </ul>
);
