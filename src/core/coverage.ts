import type { Dimension } from './findings.ts';
import type { RangeReading } from './read-range.ts';
import { notReadLine } from './skipped.ts';

export type Coverage = {
  readonly dimension: Dimension;
  readonly notRead: ReadonlyArray<string>;
};

export type CoverageFacts = Pick<
  RangeReading,
  | 'skipped'
  | 'symbolsNotRead'
  | 'measuresNotRead'
  | 'symbols'
  | 'tests'
  | 'dependencyChanges'
  | 'schemas'
  | 'migrations'
>;

const notReadFor = (name: string): string => `not read for ${name}`;

export const coverageOf = ({
  skipped,
  symbolsNotRead,
  measuresNotRead,
  symbols,
  tests,
  dependencyChanges,
  schemas,
  migrations,
}: CoverageFacts): ReadonlyArray<Coverage> => {
  const skippedStacks = skipped.flatMap(({ stacks }) => stacks);
  const symbolsMissing = [
    ...[...new Set([...skippedStacks, ...symbolsNotRead])].map(notReadFor),
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
    {
      dimension: 'metrics',
      notRead: [...new Set([...skippedStacks, ...measuresNotRead])].map(notReadFor),
    },
    {
      dimension: 'dependencies',
      notRead: dependencyChanges.flatMap(change =>
        'notRead' in change ? [`not read: ${change.lockfile}`] : [],
      ),
    },
    {
      dimension: 'schema',
      notRead: [...schemas, ...migrations].flatMap(reading =>
        'notRead' in reading ? [`not read: ${reading.file}`] : [],
      ),
    },
    { dimension: 'cohesion', notRead: [] },
  ];
};
