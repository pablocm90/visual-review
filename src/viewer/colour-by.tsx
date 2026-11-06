import { useId } from 'react';
import type { NodeMetrics } from '../core/metrics.ts';
import type { KindOfChange } from '../core/symbol-changes.ts';

export type Colouring = 'change' | 'churn' | 'complexity' | 'kind' | 'logic';

const COLOURINGS = [
  ['change', 'Change'],
  ['churn', 'Churn'],
  ['complexity', 'Complexity'],
  ['kind', 'Kind of change'],
  ['logic', 'Logic'],
] as const satisfies ReadonlyArray<readonly [Colouring, string]>;

type Shading = {
  readonly metrics: NodeMetrics | undefined;
  readonly kinds: ReadonlyArray<KindOfChange>;
  readonly changed: boolean;
  readonly decisions: number;
};

type Scale = {
  readonly title: string;
  readonly measure: string;
  readonly cuts: ReadonlyArray<number>;
  readonly steps: ReadonlyArray<string>;
  readonly read: (shading: Shading) => number | undefined;
};

type Scaled = Exclude<Colouring, 'change' | 'kind'>;

const SCALES: Readonly<Record<Scaled, Scale>> = {
  churn: {
    title: 'Churn: commits in the window before the head',
    measure: 'churn',
    cuts: [3, 6, 9],
    steps: ['0–2', '3–5', '6–8', '9+'],
    read: ({ metrics }) => (metrics?.head ?? metrics?.base)?.churn,
  },
  complexity: {
    title: 'Cyclomatic of its most complex function, at the head',
    measure: 'cyclomatic',
    cuts: [5, 8, 11],
    steps: ['0–4', '5–7', '8–10', '11+'],
    read: ({ metrics }) =>
      metrics?.head && 'lines' in metrics.head ? metrics.head.cyclomatic.highest : undefined,
  },
  logic: {
    title: 'Logic: decisions changed in it',
    measure: 'decisions',
    cuts: [1, 4, 10],
    steps: ['0', '1–3', '4–9', '10+'],
    read: ({ decisions, changed }) => (changed ? decisions : undefined),
  },
};

export type Shade = { readonly step: number; readonly name: string };

const KINDS: Readonly<Record<KindOfChange, Shade>> = {
  api: { step: 0, name: 'API change' },
  logic: { step: 1, name: 'logic change' },
  formatting: { step: 2, name: 'formatting only' },
};

const NOT_READ: Shade = { step: 3, name: 'symbols not read' };

const kindShadeOf = ({ kinds, changed }: Shading): Shade | undefined => {
  const [strongest] = kinds
    .map(kind => KINDS[kind])
    .toSorted((one, other) => one.step - other.step);
  if (strongest !== undefined) return strongest;
  return changed ? NOT_READ : undefined;
};

export const shadeOf = (colouring: Colouring, shading: Shading): Shade | undefined => {
  if (colouring === 'kind') return kindShadeOf(shading);
  if (colouring === 'change') return undefined;
  const { measure, cuts, steps, read } = SCALES[colouring];
  const value = read(shading);
  if (value === undefined) return undefined;
  const step = cuts.filter(cut => value >= cut).length;
  return { step, name: `${measure} ${value} (${steps[step]})` };
};

type Legend = { readonly title: string; readonly steps: ReadonlyArray<string> };

const KIND_LEGEND: Legend = {
  title: 'Kind of change: the strongest among its symbols',
  steps: [...Object.values(KINDS), NOT_READ].map(({ name }) => name),
};

export const ScaleLegend = ({
  colouring,
}: {
  readonly colouring: Exclude<Colouring, 'change'>;
}) => {
  const { title, steps } = colouring === 'kind' ? KIND_LEGEND : SCALES[colouring];
  return (
    <div className="scale-legend" data-colouring={colouring}>
      <span>{title}</span>
      <ul className="scale" aria-label="Scale">
        {steps.map((step, at) => (
          <li key={step} className="scale-step" data-step={at}>
            {step}
          </li>
        ))}
      </ul>
      <span>Outline still shows the change.</span>
    </div>
  );
};

type ColourByProps = {
  readonly colouring: Colouring;
  readonly onPick: (colouring: Colouring) => void;
  readonly withLogic: boolean;
};

export const ColourBy = ({ colouring, onPick, withLogic }: ColourByProps) => {
  const label = useId();
  return (
    <div className="graph-choice">
      <span id={label}>Colour by</span>
      <div role="group" aria-labelledby={label}>
        {COLOURINGS.filter(([id]) => withLogic || id !== 'logic').map(([id, name]) => (
          <button key={id} type="button" aria-pressed={id === colouring} onClick={() => onPick(id)}>
            {name}
          </button>
        ))}
      </div>
    </div>
  );
};
