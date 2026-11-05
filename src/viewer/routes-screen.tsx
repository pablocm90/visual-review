import { type ReactNode, useEffect } from 'react';
import type { PageData } from '../core/page.ts';
import type { RoutesReading } from '../core/read-routes.ts';
import {
  type KeyedStatement,
  keyedStatements,
  lineKey,
  type RouteLine,
  routeLines,
  routeOf,
} from '../core/route-lines.ts';
import type { UnreadRoute } from '../core/routes.ts';
import { CHANGE_MARKS, ChangeRow, type ChangeState, STATE_NAMES } from './change-row.tsx';

export type RoutesLanding = { readonly file: string; readonly route: string | undefined };

const placeId = ({ file, route }: RoutesLanding) => `routes:${file}:${route ?? ''}`;

const RouteRow = (routeLine: RouteLine) => {
  const { verbs, row } = routeLine;
  const { path, file, line } = routeOf(row);
  return (
    <ChangeRow
      name={`${verbs} ${path}`}
      place={placeId({ file: row.patch, route: lineKey(routeLine) })}
      state={row.state}
      base={row.state === 'added' ? '' : row.base.target}
      head={row.state === 'removed' ? '' : row.head.target}
    >
      <td className="schema-side">
        {file}:{line}
      </td>
    </ChangeRow>
  );
};

const RouteFile = ({ file, children }: { readonly file: string; readonly children: ReactNode }) => (
  <section id={placeId({ file, route: undefined })} tabIndex={-1} aria-label={file}>
    <h2 className="schema-file">
      <code>{file}</code>
    </h2>
    {children}
  </section>
);

const RouteTable = ({ lines }: { readonly lines: ReadonlyArray<RouteLine> }) => (
  <div className="schema-card">
    <table className="schema-rows">
      <thead>
        <tr>
          <td className="schema-mark" />
          <td className="schema-name" />
          <th scope="col" className="schema-head">
            Before
          </th>
          <th scope="col" className="schema-head">
            After
          </th>
          <th scope="col" className="schema-head">
            Written at
          </th>
        </tr>
      </thead>
      <tbody>
        {lines.map(line => (
          <RouteRow key={lineKey(line)} {...line} />
        ))}
      </tbody>
    </table>
  </div>
);

const FIRST: Readonly<Record<ChangeState, number>> = { removed: 0, changed: 1, added: 2 };

const lookFirst = (lines: ReadonlyArray<RouteLine>) =>
  lines.toSorted((one, other) => FIRST[one.row.state] - FIRST[other.row.state]);

const scopeOf = ({ path, module }: UnreadRoute) => [path, module].filter(Boolean).join(' · ');

const NotRead = ({ rows }: { readonly rows: ReadonlyArray<KeyedStatement> }) => (
  <>
    <p className="schema-line">Not read, so routes these draw aren't compared:</p>
    <ul className="routes-unread" aria-label="Not read">
      {rows.map(({ key, row: { state, item, patch } }) => (
        <li
          key={key}
          className="routes-statement"
          id={placeId({ file: patch, route: key })}
          tabIndex={-1}
          data-state={STATE_NAMES[state]}
        >
          <span className="schema-mark">{CHANGE_MARKS[state]}</span>
          <code>{item.text}</code>
          {scopeOf(item) && <span className="routes-where">under {scopeOf(item)}</span>}
          <span className="routes-where">
            {item.file}:{item.line}
          </span>
        </li>
      ))}
    </ul>
  </>
);

const sectionsOf = ({ routes, unread }: Exclude<RoutesReading, { readonly notRead: string }>) => {
  const linesAt = Map.groupBy(routeLines(routes), ({ row }) => row.patch);
  const statementsAt = Map.groupBy(keyedStatements(unread), ({ row }) => row.patch);
  return [...new Set([...linesAt.keys(), ...statementsAt.keys()])].map(file => {
    const lines = linesAt.get(file);
    const statements = statementsAt.get(file);
    return (
      <RouteFile key={file} file={file}>
        {statements && <NotRead rows={statements} />}
        {lines && <RouteTable lines={lookFirst(lines)} />}
      </RouteFile>
    );
  });
};

const filesOf = (reading: RoutesReading) =>
  'notRead' in reading ? (
    <RouteFile key={reading.file} file={reading.file}>
      <p className="schema-line">Not read: {reading.notRead}</p>
    </RouteFile>
  ) : (
    sectionsOf(reading)
  );

export const routesHold = (routes: PageData['routes'], path: string): boolean =>
  routes.some(reading =>
    'notRead' in reading
      ? reading.file === path
      : [...reading.routes, ...reading.unread].some(({ patch }) => patch === path),
  );

type RoutesScreenProps = {
  readonly review: Pick<PageData, 'routes'>;
  readonly landing: RoutesLanding | undefined;
  readonly onLanded: () => void;
};

export const RoutesScreen = ({ review, landing, onLanded }: RoutesScreenProps) => {
  useEffect(() => {
    if (landing === undefined) return;
    document.getElementById(placeId(landing))?.focus();
    onLanded();
  });
  return <div className="schema-screen">{review.routes.map(filesOf)}</div>;
};
