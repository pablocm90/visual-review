export type TenantUnread = {
  readonly text: string;
  readonly file: string;
  readonly line: number;
};

export type TenantConfig = {
  readonly root: string;
  readonly file: string;
  readonly excluded: ReadonlyArray<string>;
  readonly jobsCarryTenant: boolean;
  readonly unread?: ReadonlyArray<TenantUnread>;
};

export type TenantFileNotRead = {
  readonly file: string;
  readonly reason: string;
};

export type TenantTable = {
  readonly configs: ReadonlyArray<TenantConfig>;
  readonly notRead?: ReadonlyArray<TenantFileNotRead>;
};

export type TenantReader = {
  readonly holds: (path: string) => boolean;
  readonly configs: (files: ReadonlyMap<string, string>) => TenantTable;
};
