import type { ReactNode } from 'react';
import type { PageData } from '../core/page.ts';
import type { RoutesReading } from '../core/read-routes.ts';
import { type RouteLine, routeLines, routeOf } from '../core/route-lines.ts';
import { ChangeRow, type ChangeState } from './change-row.tsx';

const RouteRow = ({ verbs, row }: RouteLine) => {
  const { path, file, line } = routeOf(row);
  return (
    <ChangeRow
      name={`${verbs} ${path}`}
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

const lineKey = ({ verbs, row }: RouteLine) => {
  const { root, path } = routeOf(row);
  return `${root} ${verbs} ${path}`;
};

const RouteFile = ({ file, children }: { readonly file: string; readonly children: ReactNode }) => (
  <section aria-label={file}>
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

const filesOf = (reading: RoutesReading) => {
  if ('notRead' in reading)
    return (
      <RouteFile key={reading.file} file={reading.file}>
        <p className="schema-line">Not read: {reading.notRead}</p>
      </RouteFile>
    );
  return [...Map.groupBy(routeLines(reading.routes), ({ row }) => row.patch)].map(
    ([file, lines]) => (
      <RouteFile key={file} file={file}>
        <RouteTable lines={lookFirst(lines)} />
      </RouteFile>
    ),
  );
};

export const RoutesScreen = ({ review }: { readonly review: Pick<PageData, 'routes'> }) => (
  <div className="schema-screen">{review.routes.map(filesOf)}</div>
);
