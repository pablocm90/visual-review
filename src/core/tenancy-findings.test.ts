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

test("each app's excluded models are compared with its own", () => {
  const admin = (excluded: ReadonlyArray<string>) => config({ root: 'admin', excluded });
  const shop = (excluded: ReadonlyArray<string>) => config({ root: 'shop', excluded });

  expect(
    tenancyFindings([
      {
        base: { configs: [admin(['Company', 'Plan']), shop(['Company'])] },
        head: { configs: [admin(['Company', 'Plan']), shop(['Company', 'Plan'])] },
      },
    ]).map(({ id }) => id),
  ).toStrictEqual(['tenancy:excluded:shop:Plan']);
});

test('an app whose config was not read at the base raises nothing', () => {
  expect(
    tenancyFindings([
      {
        base: {
          configs: [],
          notRead: [{ root: '', file: FILE, reason: `Ruby syntax error in ${FILE}` }],
        },
        head: { configs: [config({ excluded: ['Company', 'Plan'] })] },
      },
    ]),
  ).toStrictEqual([]);
});

const unread = [{ text: 'EXCLUDED', file: FILE, line: 2 }];

test.for([
  {
    side: 'the head',
    base: config({ excluded: ['Company', 'Plan'] }),
    head: config({ excluded: ['Company'], unread }),
  },
  {
    side: 'the base',
    base: config({ unread }),
    head: config({ excluded: ['Company', 'Plan'] }),
  },
])(
  'an excluded_models entry not read at $side may hold the model, so it raises nothing',
  ({ base, head }) => {
    expect(tenancyFindings([reading(base, head)])).toStrictEqual([]);
  },
);

const OTHER = 'config/initializers/tenants.rb';

test("an app's configs are read together: a model raised once, on the file naming it, and one moved between them not at all", () => {
  expect(
    tenancyFindings([
      {
        base: { configs: [config({ excluded: ['Company', 'Plan', 'User'] })] },
        head: {
          configs: [
            config({ excluded: ['Company', 'Seat'] }),
            config({ file: OTHER, excluded: ['User', 'Seat', 'Team'] }),
          ],
        },
      },
    ]).map(({ id, file }) => [id, file]),
  ).toStrictEqual([
    ['tenancy:excluded::Seat', FILE],
    ['tenancy:excluded::Team', OTHER],
    ['tenancy:excluded::Plan', FILE],
  ]);
});

test.for([
  {
    side: 'base',
    hidden: 'added',
    base: [config({ excluded: [] }), config({ file: OTHER, excluded: [], unread })],
    head: [config({ excluded: ['Plan'] })],
  },
  {
    side: 'head',
    hidden: 'removed',
    base: [config({ excluded: ['Plan'] })],
    head: [config({ excluded: [] }), config({ file: OTHER, excluded: [], unread })],
  },
])(
  "one of an app's configs not read at the $side hides what its others $hidden",
  ({ base, head }) => {
    expect(tenancyFindings([{ base: { configs: base }, head: { configs: head } }])).toStrictEqual(
      [],
    );
  },
);
