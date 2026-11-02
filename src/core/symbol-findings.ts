import type { Finding } from './findings.ts';
import type { SymbolFile } from './read-range.ts';
import type { SymbolStatement } from './symbol-changes.ts';

const qualified = ({ scope, name }: SymbolStatement): string =>
  scope === undefined ? name : `${scope}.${name}`;

type Removal = { readonly former: string; readonly how: string };

const removalOf = (statement: SymbolStatement): Removal | undefined => {
  if (statement.exported.base !== true) return undefined;
  const name = qualified(statement);
  if (statement.renamedFrom !== undefined) {
    const renamed = statement.probably ? 'probably renamed' : 'renamed';
    return { former: statement.renamedFrom, how: `${renamed} to ${name}` };
  }
  if (statement.movedTo !== undefined)
    return { former: name, how: `moved to ${statement.movedTo}` };
  if (statement.change === 'removed') return { former: name, how: 'removed' };
  return statement.exported.head === false
    ? { former: name, how: 'no longer exported' }
    : undefined;
};

export const symbolFindings = (files: ReadonlyArray<SymbolFile>): ReadonlyArray<Finding> =>
  files.flatMap(file =>
    'unreadable' in file
      ? []
      : file.symbols.flatMap((statement): ReadonlyArray<Finding> => {
          const removal = removalOf(statement);
          return removal === undefined
            ? []
            : [
                {
                  id: `api:removed:${file.node}#${removal.former}`,
                  dimension: 'api',
                  level: 'look',
                  target: file.node,
                  title: `${statement.kind} ${removal.former} ${removal.how}`,
                },
              ];
        }),
  );
