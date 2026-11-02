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

type Placed = { readonly node: string; readonly statement: SymbolStatement };

const findingOf = ({ node, statement }: Placed): Finding | undefined => {
  const removal = removalOf(statement);
  const on = { dimension: 'api', level: 'look', target: node } as const;
  if (removal !== undefined)
    return {
      id: `api:removed:${node}#${removal.former}`,
      ...on,
      title: `${statement.kind} ${removal.former} ${removal.how}`,
    };
  const { signature, exported } = statement;
  if (signature === undefined || exported.base !== true) return undefined;
  const name = qualified(statement);
  return {
    id: `api:signature:${node}#${name}`,
    ...on,
    title: `${statement.kind} ${name}'s signature changed`,
    detail: `${signature.base} → ${signature.head}`,
  };
};

export const symbolFindings = (files: ReadonlyArray<SymbolFile>): ReadonlyArray<Finding> =>
  files.flatMap(file =>
    'unreadable' in file
      ? []
      : file.symbols.flatMap(statement => findingOf({ node: file.node, statement }) ?? []),
  );
