import type { Dimension } from './findings.ts';
import type { RangeReading } from './read-range.ts';
import { notReadLine } from './skipped.ts';

export type Coverage = {
  readonly dimension: Dimension;
  readonly notRead: ReadonlyArray<string>;
};

export type CoverageFacts = Pick<RangeReading, 'skipped' | 'symbolsNotRead' | 'symbols' | 'tests'>;

const notReadFor = (name: string): string => `not read for ${name}`;

export const coverageOf = ({
  skipped,
  symbolsNotRead,
  symbols,
  tests,
}: CoverageFacts): ReadonlyArray<Coverage> => {
  const symbolsMissing = [
    ...[...new Set([...skipped.flatMap(({ stacks }) => stacks), ...symbolsNotRead])].map(
      notReadFor,
    ),
    ...symbols.flatMap(file => ('unreadable' in file ? [notReadFor(file.node)] : [])),
  ];
  return [
    { dimension: 'structure', notRead: skipped.map(notReadLine) },
    { dimension: 'logic', notRead: symbolsMissing },
    { dimension: 'api', notRead: symbolsMissing },
    {
      dimension: 'tests',
      notRead: [
        ...symbolsMissing,
        ...tests.flatMap(file => ('unreadable' in file ? [notReadFor(file.path)] : [])),
      ],
    },
    { dimension: 'cohesion', notRead: [] },
  ];
};
