import type { SchemaColumn, SchemaIndex, SchemaTable } from './schema.ts';

export type SchemaChange<T> =
  | { readonly state: 'added'; readonly head: T }
  | { readonly state: 'removed'; readonly base: T }
  | { readonly state: 'changed'; readonly base: T; readonly head: T };

export type TableChange = {
  readonly name: string;
  readonly state: SchemaChange<unknown>['state'];
  readonly options: { readonly base: string; readonly head: string };
  readonly columns: ReadonlyArray<SchemaChange<SchemaColumn>>;
  readonly indexes: ReadonlyArray<SchemaChange<SchemaIndex>>;
};

type Sides<T> = { readonly base: ReadonlyArray<T>; readonly head: ReadonlyArray<T> };

const pairedByName = <T extends { readonly name: string }>({
  base,
  head,
}: Sides<T>): ReadonlyArray<SchemaChange<T>> => {
  const baseOf = new Map(base.map(item => [item.name, item]));
  const inHead = new Set(head.map(({ name }) => name));
  return [
    ...head.map((item): SchemaChange<T> => {
      const other = baseOf.get(item.name);
      return other === undefined
        ? { state: 'added', head: item }
        : { state: 'changed', base: other, head: item };
    }),
    ...base
      .filter(({ name }) => !inHead.has(name))
      .map((item): SchemaChange<T> => ({ state: 'removed', base: item })),
  ];
};

const changesIn = <T extends { readonly name: string }>(
  sides: Sides<T>,
): ReadonlyArray<SchemaChange<T>> =>
  pairedByName(sides).filter(
    change =>
      change.state !== 'changed' || JSON.stringify(change.base) !== JSON.stringify(change.head),
  );

const NOTHING: Omit<SchemaTable, 'name'> = { options: '', columns: [], indexes: [] };

const tableChangeOf = (change: SchemaChange<SchemaTable>): ReadonlyArray<TableChange> => {
  const base = change.state === 'added' ? NOTHING : change.base;
  const head = change.state === 'removed' ? NOTHING : change.head;
  const columns = changesIn({ base: base.columns, head: head.columns });
  const indexes = changesIn({ base: base.indexes, head: head.indexes });
  const isUnchanged =
    change.state === 'changed' &&
    columns.length === 0 &&
    indexes.length === 0 &&
    base.options === head.options;
  if (isUnchanged) return [];
  const { name } = change.state === 'removed' ? change.base : change.head;
  const options = { base: base.options, head: head.options };
  return [{ name, state: change.state, options, columns, indexes }];
};

export const diffTables = (tables: Sides<SchemaTable>): ReadonlyArray<TableChange> =>
  pairedByName(tables).flatMap(tableChangeOf);
