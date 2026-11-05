import type { Dimension } from './findings.ts';
import type { RangeReading } from './read-range.ts';
import { notReadLine } from './skipped.ts';

export type Coverage = {
  readonly dimension: Dimension;
  readonly notRead: ReadonlyArray<string>;
};

export type CoverageFacts = Pick<RangeReading, 'skipped'>;

export const coverageOf = ({ skipped }: CoverageFacts): ReadonlyArray<Coverage> => [
  { dimension: 'structure', notRead: skipped.map(notReadLine) },
  { dimension: 'cohesion', notRead: [] },
];
