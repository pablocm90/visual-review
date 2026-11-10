import type { Finding } from './findings.ts';
import type { TenancyReading } from './read-tenancy.ts';
import type { TenantConfig, TenantTable } from './tenant.ts';

type Said = { readonly model: string; readonly title: string; readonly detail: string };

const added = (model: string): Said => ({
  model,
  title: `${model} added to excluded_models`,
  detail:
    "Its rows now live in the public schema, shared by every tenant; the rows in each tenant's own table are left behind.",
});

const removed = (model: string): Said => ({
  model,
  title: `${model} no longer excluded`,
  detail:
    'Each tenant now reads its own table of it; the rows in the public schema are no longer read there.',
});

const gained = (
  models: ReadonlyArray<string>,
  others: ReadonlyArray<string>,
): ReadonlyArray<string> => models.filter(model => !others.includes(model));

const hidesModels = ({ unread = [] }: Pick<TenantConfig, 'unread'>): boolean => unread.length > 0;

const ofApp = (configs: ReadonlyArray<TenantConfig>, root: string): ReadonlyArray<TenantConfig> =>
  configs.filter(config => config.root === root);

const firstOfEachApp = (configs: ReadonlyArray<TenantConfig>): ReadonlyArray<TenantConfig> =>
  configs.filter(
    (config, index) => configs.findIndex(other => other.root === config.root) === index,
  );

const modelsOf = (configs: ReadonlyArray<TenantConfig>): ReadonlyArray<string> => [
  ...new Set(configs.flatMap(config => config.excluded)),
];

export const tenancyFindings = (tenancy: ReadonlyArray<TenancyReading>): ReadonlyArray<Finding> =>
  tenancy.flatMap(({ base, head }) =>
    firstOfEachApp(head.configs).flatMap(first => {
      const { root } = first;
      const atBase = ofApp(base.configs, root);
      if (atBase.length === 0) return [];
      const atHead = ofApp(head.configs, root);
      const before = modelsOf(atBase);
      const after = modelsOf(atHead);
      const fileOf = (model: string): string =>
        (atHead.find(config => config.excluded.includes(model)) ?? first).file;
      return [
        ...(atBase.some(hidesModels) ? [] : gained(after, before).map(added)),
        ...(atHead.some(hidesModels) ? [] : gained(before, after).map(removed)),
      ].map(
        ({ model, ...said }): Finding => ({
          id: `tenancy:excluded:${root}:${model}`,
          check: 'tenancy:excluded',
          dimension: 'tenancy',
          level: 'look',
          file: fileOf(model),
          ...said,
        }),
      );
    }),
  );

type Unsaid = { readonly key: string; readonly said: (atSide: string) => string };

const sideLines = (
  atBase: ReadonlyArray<Unsaid>,
  atHead: ReadonlyArray<Unsaid>,
): ReadonlyArray<string> => [
  ...atHead.map(({ said }) => said('not read')),
  ...atBase
    .filter(({ key }) => !atHead.some(other => other.key === key))
    .map(({ said }) => said('not read at the base')),
];

const filesOf = ({ notRead = [] }: TenantTable): ReadonlyArray<Unsaid> =>
  notRead.map(({ file, reason }) => ({ key: file, said: atSide => `${atSide}: ${reason}` }));

const entriesOf = ({ configs }: TenantTable): ReadonlyArray<Unsaid> =>
  configs.flatMap(({ unread = [] }) =>
    unread.map(({ file, line, text }) => ({
      key: JSON.stringify([file, text]),
      said: atSide => `${file}:${line} ${atSide}: ${text}`,
    })),
  );

const linesOf = ({ base, head }: TenancyReading): ReadonlyArray<string> => [
  ...sideLines(filesOf(base), filesOf(head)),
  ...sideLines(entriesOf(base), entriesOf(head)),
];

const foundNone = ({ base, head }: TenancyReading): boolean =>
  [base, head].every(({ configs, notRead = [] }) => configs.length === 0 && notRead.length === 0);

export const tenancyNotRead = (tenancy: ReadonlyArray<TenancyReading>): ReadonlyArray<string> =>
  tenancy.every(foundNone) ? ['Apartment only'] : tenancy.flatMap(linesOf);
