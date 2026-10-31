import { useId } from 'react';
import type { NodeMetrics } from '../core/metrics.ts';

export type Colouring = 'change' | 'churn';

const COLOURINGS = [
  ['change', 'Change'],
  ['churn', 'Churn'],
] as const satisfies ReadonlyArray<readonly [Colouring, string]>;

const CHURN = { cuts: [3, 6, 9], steps: ['0–2', '3–5', '6–8', '9+'] };

export type Shade = { readonly step: number; readonly name: string };

export const shadeOf = (
  colouring: Colouring,
  metrics: NodeMetrics | undefined,
): Shade | undefined => {
  const measures = metrics?.head ?? metrics?.base;
  if (colouring === 'change' || measures === undefined) return undefined;
  const step = CHURN.cuts.filter(cut => measures.churn >= cut).length;
  return { step, name: `churn ${measures.churn} (${CHURN.steps[step]})` };
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
