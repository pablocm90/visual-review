export type Cover = {
  readonly by: string;
  readonly conditional: boolean;
};

export type Action = {
  readonly controller: string;
  readonly action: string;
  readonly root: string;
  readonly file: string;
  readonly line: number;
  readonly cover?: Cover;
};

export type UnreadAccess = {
  readonly text: string;
  readonly file: string;
  readonly line: number;
};

export type AccessTable = {
  readonly actions: ReadonlyArray<Action>;
  readonly unread: ReadonlyArray<UnreadAccess>;
};

export type AccessAsked = {
  readonly files: ReadonlyMap<string, string>;
  readonly authorize: ReadonlyArray<string>;
};

export type AccessReader = {
  readonly holds: (path: string) => boolean;
  readonly actions: (asked: AccessAsked) => AccessTable;
};
