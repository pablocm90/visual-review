import type { MetricFinding } from '../core/metric-findings.ts';

export const tenths = (value: number) => Math.round(value * 10) / 10;

const LEVELS: Readonly<Record<MetricFinding['level'], string>> = {
  look: 'needs a look',
  info: 'for information',
};

export const LevelMark = ({ level }: { readonly level: MetricFinding['level'] }) => (
  <svg className="level-mark" viewBox="0 0 16 16" role="img" aria-label={LEVELS[level]}>
    {level === 'look' ? <path d="M8 2 L14.5 13.5 H1.5 Z" /> : <circle cx={8} cy={8} r={6} />}
  </svg>
);
