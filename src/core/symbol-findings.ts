import type { Finding } from './findings.ts';
import type { SymbolFile } from './read-range.ts';
import type { SymbolStatement } from './symbol-changes.ts';

const qualified = ({ scope, name }: SymbolStatement): string =>
  scope === undefined ? name : `${scope}.${name}`;

const removedTitle = (statement: SymbolStatement): string | undefined => {
  if (statement.exported.base !== true) return undefined;
  if (statement.change === 'removed') return 'removed';
  return statement.exported.head === false ? 'no longer exported' : undefined;
};

export const symbolFindings = (files: ReadonlyArray<SymbolFile>): ReadonlyArray<Finding> =>
  files.flatMap(file =>
    'unreadable' in file
      ? []
      : file.symbols.flatMap((statement): ReadonlyArray<Finding> => {
          const title = removedTitle(statement);
          return title === undefined
            ? []
            : [
                {
                  id: `api:removed:${file.node}#${qualified(statement)}`,
                  dimension: 'api',
                  level: 'look',
                  target: file.node,
                  title: `${statement.kind} ${qualified(statement)} ${title}`,
                },
              ];
        }),
  );
