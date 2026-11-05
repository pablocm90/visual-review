export type SchemaColumn = {
  readonly name: string;
  readonly type: string;
  readonly options: string;
};

export type SchemaIndex = {
  readonly name: string;
  readonly columns: ReadonlyArray<string>;
  readonly options: string;
};

export type SchemaTable = {
  readonly name: string;
  readonly options: string;
  readonly columns: ReadonlyArray<SchemaColumn>;
  readonly indexes: ReadonlyArray<SchemaIndex>;
};

export type SchemaReader = {
  readonly holds: (path: string) => boolean;
  readonly tables: (text: string) => ReadonlyArray<SchemaTable>;
};
