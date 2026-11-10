import { filesHeldAt } from './git.ts';
import type { TenantReader, TenantTable } from './tenant.ts';

export type TenancyReading = { readonly base: TenantTable; readonly head: TenantTable };

type ReadTenancyOptions = {
  readonly repo: string;
  readonly base: string;
  readonly head: string;
  readonly tenancy: ReadonlyArray<TenantReader>;
};

export const readTenancy = ({
  repo,
  base,
  head,
  tenancy,
}: ReadTenancyOptions): Promise<ReadonlyArray<TenancyReading>> => {
  const tableAt = async (revision: string, reader: TenantReader): Promise<TenantTable> =>
    reader.configs(await filesHeldAt({ repo, revision, holds: reader.holds }));
  return Promise.all(
    tenancy.map(async reader => ({
      base: await tableAt(base, reader),
      head: await tableAt(head, reader),
    })),
  );
};
