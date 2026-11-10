import { expect, test } from 'vitest';
import type { TenancyReading } from './read-tenancy.ts';
import { tenancyFindings } from './tenancy-findings.ts';
import type { TenantConfig } from './tenant.ts';

const FILE = 'config/initializers/apartment.rb';

const config = (overrides: Partial<TenantConfig> = {}): TenantConfig => ({
  root: '',
  file: FILE,
  excluded: ['Company'],
  jobsCarryTenant: false,
  ...overrides,
});

const reading = (base: TenantConfig, head: TenantConfig): TenancyReading => ({
  base: { configs: [base] },
  head: { configs: [head] },
});

test('a model newly excluded needs a look, on the config at the head', () => {
  expect(
    tenancyFindings([reading(config(), config({ excluded: ['Company', 'Plan'] }))]),
  ).toStrictEqual([
    {
      id: 'tenancy:excluded::Plan',
      check: 'tenancy:excluded',
      dimension: 'tenancy',
      level: 'look',
      file: FILE,
      title: 'Plan added to excluded_models',
      detail:
        "Its rows now live in the public schema, shared by every tenant; the rows in each tenant's own table are left behind.",
    },
  ]);
});

test('a model no longer excluded needs a look too', () => {
  expect(
    tenancyFindings([reading(config({ excluded: ['Company', 'Plan'] }), config())]),
  ).toMatchObject([
    {
      id: 'tenancy:excluded::Plan',
      level: 'look',
      file: FILE,
      title: 'Plan no longer excluded',
      detail:
        'Each tenant now reads its own table of it; the rows in the public schema are no longer read there.',
    },
  ]);
});
