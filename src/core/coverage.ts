import { accessNotRead } from './access-findings.ts';
import type { Dimension } from './findings.ts';
import { NO_AXUM_CRATE } from './linker.ts';
import type { RangeReading } from './read-range.ts';
import { notReadLine } from './skipped.ts';
import { qualified } from './symbol-changes.ts';
import { tenancyNotRead } from './tenancy-findings.ts';

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
  | 'routes'
  | 'reachesNotRead'
  | 'rulesNotRead'
  | 'access'
  | 'openActions'
  | 'tenancy'
>;

const notReadFor = (name: string): string => `not read for ${name}`;

const unreadIn = (symbols: CoverageFacts['symbols']): ReadonlyArray<string> =>
  symbols.flatMap(file => ('unreadable' in file ? [notReadFor(file.node)] : []));

const permitsUnreadIn = (symbols: CoverageFacts['symbols']): ReadonlyArray<string> =>
  symbols.flatMap(file =>
    'unreadable' in file
      ? []
      : file.symbols.flatMap(statement =>
          (statement.risks ?? [])
            .filter(risk => risk.unread)
            .map(risk => `${file.node} not read: permit(${risk.text}) in ${qualified(statement)}`),
        ),
  );

const securityNotRead = ({
  access,
  readers,
  routes,
  openActions,
  symbols,
}: Pick<
  CoverageFacts,
  'access' | 'readers' | 'routes' | 'openActions' | 'symbols'
>): ReadonlyArray<string> =>
  access.length === 0 && !readers.includes('rails')
    ? ['authorization and risky calls: Rails only']
    : [
        ...accessNotRead({
          access,
          routes: routes.flatMap(reading => ('routes' in reading ? reading.routes : [])),
          open: openActions,
        }),
        ...unreadIn(symbols),
        ...permitsUnreadIn(symbols),
        ...readers
          .filter(reader => reader !== 'rails')
          .map(reader => `risky calls not read for ${reader}`),
      ];

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
  routes,
  reachesNotRead,
  rulesNotRead,
  access,
  openActions,
  tenancy,
}: CoverageFacts): ReadonlyArray<Coverage> => {
  const skippedStacks = skipped.flatMap(({ stacks }) => stacks);
  const symbolsMissing = [
    ...[...new Set([...skippedStacks, ...symbolsNotRead])].map(notReadFor),
    ...unreadIn(symbols),
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
  const railsRoutes = routes.length > 0 || readers.includes('rails');
  const routesNotRead = [
    ...linksNotRead.filter(reason => !railsRoutes || reason !== NO_AXUM_CRATE),
    ...routes.flatMap(reading => ('notRead' in reading ? [`not read: ${reading.file}`] : [])),
  ];
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
    { dimension: 'rules', notRead: rulesNotRead },
    { dimension: 'schema', notRead: schemaNotRead },
    { dimension: 'routes', notRead: routesNotRead },
    { dimension: 'blast-radius', notRead: ifDrawn([...symbolsMissing, ...reachesNotRead]) },
    { dimension: 'cohesion', notRead: [] },
    {
      dimension: 'security',
      notRead: securityNotRead({ access, readers, routes, openActions, symbols }),
    },
    { dimension: 'tenancy', notRead: tenancyNotRead(tenancy) },
  ];
};
