import type { Dimension } from './findings.ts';
import type { RangeReading } from './read-range.ts';
import { notReadLine } from './skipped.ts';

export type Coverage = {
  readonly dimension: Dimension;
  readonly notRead: ReadonlyArray<string>;
};

export type CoverageFacts = Pick<RangeReading, 'skipped' | 'symbolsNotRead'>;

export const coverageOf = ({ skipped, symbolsNotRead }: CoverageFacts): ReadonlyArray<Coverage> => {
  const symbolsMissing = [
    ...new Set([...skipped.flatMap(({ stacks }) => stacks), ...symbolsNotRead]),
  ].map(stack => `not read for ${stack}`);
  return [
    { dimension: 'structure', notRead: skipped.map(notReadLine) },
    { dimension: 'logic', notRead: symbolsMissing },
    { dimension: 'api', notRead: symbolsMissing },
    { dimension: 'tests', notRead: symbolsMissing },
    { dimension: 'cohesion', notRead: [] },
  ];
};
