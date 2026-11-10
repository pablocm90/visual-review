import type { Finding } from './findings.ts';
import type { TenancyReading } from './read-tenancy.ts';

export const tenancyFindings = (tenancy: ReadonlyArray<TenancyReading>): ReadonlyArray<Finding> =>
  tenancy.flatMap(({ base, head }) =>
    head.configs.flatMap(({ root, file, excluded }) => {
      const before = new Set(base.configs.flatMap(config => config.excluded));
      return excluded
        .filter(model => !before.has(model))
        .map(
          (model): Finding => ({
            id: `tenancy:excluded:${root}:${model}`,
            check: 'tenancy:excluded',
            dimension: 'tenancy',
            level: 'look',
            file,
            title: `${model} added to excluded_models`,
            detail:
              "Its rows now live in the public schema, shared by every tenant; the rows in each tenant's own table are left behind.",
          }),
        );
    }),
  );
