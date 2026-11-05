import { useEffect } from 'react';
import { counted } from '../core/findings.ts';
import type { PageData } from '../core/page.ts';
import type { SchemaReading } from '../core/read-schemas.ts';
import type { SchemaColumn, SchemaIndex } from '../core/schema.ts';
import type { SchemaChange, TableChange } from '../core/schema-diff.ts';

const MARKS: Readonly<Record<SchemaChange<unknown>['state'], string>> = {
  added: '+',
  removed: '−',
  changed: '~',
};

const STATE_NAMES: Readonly<Record<SchemaChange<unknown>['state'], string>> = {
  added: 'added',
  removed: 'removed',
  changed: 'modified',
};

const textOf = (parts: ReadonlyArray<string>) => parts.filter(Boolean).join(' ');

const columnText = ({ type, options }: SchemaColumn) => textOf([type, options]);

const indexText = ({ columns, options }: SchemaIndex) => textOf([columns.join(', '), options]);

type RowProps = {
  readonly name: string;
  readonly state: SchemaChange<unknown>['state'];
  readonly base: string;
  readonly head: string;
};

const Row = ({ name, state, base, head }: RowProps) => (
  <tr data-state={STATE_NAMES[state]}>
    <td className="schema-mark">{MARKS[state]}</td>
    <th scope="row" className="schema-name">
      {name}
    </th>
    <td className="schema-side">{base}</td>
    <td className="schema-side">{head}</td>
  </tr>
);

const rowOf =
  <T extends { readonly name: string }>(text: (item: T) => string) =>
  (change: SchemaChange<T>) => {
    const item = change.state === 'removed' ? change.base : change.head;
    return (
      <Row
        key={item.name}
        name={item.name}
        state={change.state}
        base={change.state === 'added' ? '' : text(change.base)}
        head={change.state === 'removed' ? '' : text(change.head)}
      />
    );
  };

export type SchemaLanding = { readonly file: string; readonly table: string | undefined };

const placeId = ({ file, table }: SchemaLanding) => `schema:${file}:${table ?? ''}`;

const TableCard = ({ file, table }: { readonly file: string; readonly table: TableChange }) => (
  <article
    id={placeId({ file, table: table.name })}
    tabIndex={-1}
    className="schema-card"
    aria-label={`${table.name}, ${table.state}`}
  >
    <h3 className="schema-table" data-state={STATE_NAMES[table.state]}>
      {table.name} <span className="schema-table-state">{table.state}</span>
    </h3>
    <table className="schema-rows">
      <thead>
        <tr>
          <td />
          <td />
          <th scope="col" className="schema-head">
            Before
          </th>
          <th scope="col" className="schema-head">
            After
          </th>
        </tr>
      </thead>
      <tbody>
        {table.options.base !== table.options.head && (
          <Row name="Table options" state={table.state} {...table.options} />
        )}
        {table.columns.map(rowOf(columnText))}
        {table.indexes.map(rowOf(indexText))}
      </tbody>
    </table>
  </article>
);

const WholeFile = ({ reading }: { readonly reading: SchemaReading }) => {
  if ('notRead' in reading) return <p className="schema-line">Not read: {reading.notRead}</p>;
  if ('whole' in reading)
    return (
      <p className="schema-line">
        File {reading.whole}, with {counted(reading.tableCount, 'table', 'tables')}.
      </p>
    );
  return null;
};

type SchemaScreenProps = {
  readonly review: Pick<PageData, 'schemas'>;
  readonly landing: SchemaLanding | undefined;
  readonly onLanded: () => void;
};

export const SchemaScreen = ({ review, landing, onLanded }: SchemaScreenProps) => {
  useEffect(() => {
    if (landing === undefined) return;
    document.getElementById(placeId(landing))?.focus();
    onLanded();
  });
  return (
    <div className="schema-screen">
      {review.schemas.map(reading => (
        <section
          key={reading.file}
          id={placeId({ file: reading.file, table: undefined })}
          tabIndex={-1}
          aria-label={reading.file}
        >
          <h2 className="schema-file">
            <code>{reading.file}</code>
          </h2>
          <WholeFile reading={reading} />
          {'tables' in reading &&
            reading.tables.map(table => (
              <TableCard key={table.name} file={reading.file} table={table} />
            ))}
        </section>
      ))}
    </div>
  );
};
