import type { Finding } from './findings.ts';
import type { TenancyReading } from './read-tenancy.ts';

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

export const tenancyFindings = (tenancy: ReadonlyArray<TenancyReading>): ReadonlyArray<Finding> =>
  tenancy.flatMap(({ base, head }) =>
    head.configs.flatMap(({ root, file, excluded }) => {
      const atBase = base.configs.filter(config => config.root === root);
      if (atBase.length === 0) return [];
      const before = atBase.flatMap(config => config.excluded);
      return [...gained(excluded, before).map(added), ...gained(before, excluded).map(removed)].map(
        ({ model, ...said }): Finding => ({
          id: `tenancy:excluded:${root}:${model}`,
          check: 'tenancy:excluded',
          dimension: 'tenancy',
          level: 'look',
          file,
          ...said,
        }),
      );
    }),
  );
