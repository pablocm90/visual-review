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
  | 'readers'
  | 'linksNotRead'
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
  readers,
  linksNotRead,
}: CoverageFacts): ReadonlyArray<Coverage> => {
  const skippedStacks = skipped.flatMap(({ stacks }) => stacks);
  const symbolsMissing = [
    ...[...new Set([...skippedStacks, ...symbolsNotRead])].map(notReadFor),
    ...symbols.flatMap(file => ('unreadable' in file ? [notReadFor(file.node)] : [])),
  ];
  const ifDrawn = (notRead: ReadonlyArray<string>): ReadonlyArray<string> =>
    readers.length === 0 ? ['no stack drawn'] : notRead;
  const schemaReadings = [...schemas, ...migrations];
  const schemaNotRead =
    schemaReadings.length === 0 && !readers.includes('rails')
      ? ['Rails only']
      : schemaReadings.flatMap(reading =>
          'notRead' in reading ? [`not read: ${reading.file}`] : [],
        );
  return [
    { dimension: 'structure', notRead: skipped.map(notReadLine) },
    { dimension: 'logic', notRead: ifDrawn(symbolsMissing) },
    { dimension: 'api', notRead: ifDrawn(symbolsMissing) },
    {
      dimension: 'tests',
      notRead: ifDrawn([
        ...symbolsMissing,
        ...tests.flatMap(file => ('unreadable' in file ? [notReadFor(file.path)] : [])),
      ]),
    },
    {
      dimension: 'metrics',
      notRead: ifDrawn([...new Set([...skippedStacks, ...measuresNotRead])].map(notReadFor)),
    },
    {
      dimension: 'dependencies',
      notRead: dependencyChanges.flatMap(change =>
        'notRead' in change ? [`not read: ${change.lockfile}`] : [],
      ),
    },
    { dimension: 'schema', notRead: schemaNotRead },
    { dimension: 'routes', notRead: linksNotRead },
    { dimension: 'cohesion', notRead: [] },
  ];
};
