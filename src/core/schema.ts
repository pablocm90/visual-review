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

export type TableColumn = { readonly table: string; readonly column: string };

/** A file at the head naming a column, by name. */
export type NamedColumn = { readonly path: string; readonly column: string };

export type SchemaReader = {
  readonly holds: (path: string) => boolean;
  readonly tables: (text: string) => ReadonlyArray<SchemaTable>;
  /** The columns a model file lists in `ignored_columns`, on each table it may read. */
  readonly ignored: (model: {
    readonly path: string;
    readonly text: string;
  }) => ReadonlyArray<TableColumn>;
};
