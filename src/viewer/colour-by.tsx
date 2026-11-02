import { useId } from 'react';
import type { NodeMetrics } from '../core/metrics.ts';
import type { KindOfChange } from '../core/symbol-changes.ts';

export type Colouring = 'change' | 'churn' | 'complexity' | 'kind';

const COLOURINGS = [
  ['change', 'Change'],
  ['churn', 'Churn'],
  ['complexity', 'Complexity'],
  ['kind', 'Kind of change'],
] as const satisfies ReadonlyArray<readonly [Colouring, string]>;

type Scale = {
  readonly title: string;
  readonly measure: string;
  readonly cuts: ReadonlyArray<number>;
  readonly steps: ReadonlyArray<string>;
  readonly read: (metrics: NodeMetrics) => number | undefined;
};

type Scaled = Exclude<Colouring, 'change' | 'kind'>;

const SCALES: Readonly<Record<Scaled, Scale>> = {
  churn: {
    title: 'Churn: commits in the window before the head',
    measure: 'churn',
    cuts: [3, 6, 9],
    steps: ['0–2', '3–5', '6–8', '9+'],
    read: ({ head, base }) => (head ?? base)?.churn,
  },
  complexity: {
    title: 'Cyclomatic of its most complex function, at the head',
    measure: 'cyclomatic',
    cuts: [5, 8, 11],
    steps: ['0–4', '5–7', '8–10', '11+'],
    read: ({ head }) => (head && 'lines' in head ? head.cyclomatic.highest : undefined),
  },
};

export type Shade = { readonly step: number; readonly name: string };

const KINDS: Readonly<Record<KindOfChange, Shade>> = {
  api: { step: 0, name: 'API change' },
  logic: { step: 1, name: 'logic change' },
  formatting: { step: 2, name: 'formatting only' },
};

type Shading = {
  readonly metrics: NodeMetrics | undefined;
  readonly kind: KindOfChange | undefined;
};

export const shadeOf = (colouring: Colouring, { metrics, kind }: Shading): Shade | undefined => {
  if (colouring === 'kind') return kind === undefined ? undefined : KINDS[kind];
  if (colouring === 'change' || metrics === undefined) return undefined;
  const { measure, cuts, steps, read } = SCALES[colouring];
  const value = read(metrics);
  if (value === undefined) return undefined;
  const step = cuts.filter(cut => value >= cut).length;
  return { step, name: `${measure} ${value} (${steps[step]})` };
};

export const ScaleLegend = ({ colouring }: { readonly colouring: Scaled }) => {
  const { title, steps } = SCALES[colouring];
  return (
    <div className="scale-legend">
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
};

export const ColourBy = ({ colouring, onPick }: ColourByProps) => {
  const label = useId();
  return (
    <div className="colour-by">
      <span id={label}>Colour by</span>
      <div role="group" aria-labelledby={label}>
        {COLOURINGS.map(([id, name]) => (
          <button key={id} type="button" aria-pressed={id === colouring} onClick={() => onPick(id)}>
            {name}
          </button>
        ))}
      </div>
    </div>
  );
};
