import type { Finding } from './findings.ts';
import type { SymbolFile } from './read-range.ts';
import type { FileSymbolChanges, SymbolStatement } from './symbol-changes.ts';

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

const addedHow = ({ change, movedFrom }: SymbolStatement): string => {
  if (change === 'added') return 'added';
  return movedFrom === undefined ? 'now exported' : `moved from ${movedFrom}`;
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
  const name = qualified(statement);
  if (exported.base !== true)
    return exported.head === true
      ? {
          id: `api:added:${node}#${name}`,
          ...on,
          level: 'info',
          title: `${statement.kind} ${name} ${addedHow(statement)}`,
        }
      : undefined;
  if (signature === undefined) return undefined;
  return {
    id: `api:signature:${node}#${name}`,
    ...on,
    title: `${statement.kind} ${name}'s signature changed`,
    detail: `${signature.base} → ${signature.head}`,
  };
};

const exportsFinding = (file: FileSymbolChanges): ReadonlyArray<Finding> => {
  const behind = new Set(file.symbols.flatMap(({ name, renamedFrom }) => [name, renamedFrom]));
  const unbacked = (names: ReadonlyArray<string>) => names.filter(name => !behind.has(name));
  const removed = unbacked(file.exports.removed);
  const added = unbacked(file.exports.added);
  const parts = [
    ...(removed.length === 0 ? [] : [`removed ${removed.join(', ')}`]),
    ...(added.length === 0 ? [] : [`added ${added.join(', ')}`]),
  ];
  if (parts.length === 0) return [];
  return [
    {
      id: `api:exports:${file.node}`,
      dimension: 'api',
      level: removed.length === 0 ? 'info' : 'look',
      target: file.node,
      title: 'export list changed',
      detail: parts.join('; '),
    },
  ];
};

export const symbolFindings = (files: ReadonlyArray<SymbolFile>): ReadonlyArray<Finding> =>
  files.flatMap(file =>
    'unreadable' in file
      ? []
      : [
          ...file.symbols.flatMap(statement => findingOf({ node: file.node, statement }) ?? []),
          ...exportsFinding(file),
        ],
  );
