import { countedId } from './counted-id.ts';
import type { Finding } from './findings.ts';
import type { MigrationRisk } from './migration.ts';
import type { MigrationReading } from './read-migrations.ts';

const riskFindings = (file: string, risks: ReadonlyArray<MigrationRisk>): ReadonlyArray<Finding> =>
  risks.map(({ title, why, line }, index) => ({
    id: countedId(
      `schema:${file}:${title}`,
      risks.slice(0, index).filter(other => other.title === title).length,
    ),
    check: 'schema:migration-risk',
    dimension: 'schema',
    level: 'look',
    file,
    title,
    detail: `${file}:${line}. ${why}`,
  }));

export const migrationFindings = (
  readings: ReadonlyArray<MigrationReading>,
): ReadonlyArray<Finding> =>
  readings.flatMap(reading =>
    'notRead' in reading
      ? [
          {
            id: `schema:not-read:${reading.file}`,
            check: 'schema:not-read',
            dimension: 'schema',
            level: 'look',
            file: reading.file,
            title: `${reading.file} not read: ${reading.notRead}`,
          },
        ]
      : riskFindings(reading.file, reading.risks),
  );
