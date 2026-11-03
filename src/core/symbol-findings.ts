import type { Finding } from './findings.ts';
import type { GraphNode } from './graph.ts';
import type { LogicLine } from './logic-diff.ts';
import type { SymbolFile } from './read-range.ts';
import { type FileSymbolChanges, qualified, type SymbolStatement } from './symbol-changes.ts';

type Removal = { readonly former: string; readonly how: string; readonly detail?: string };

type PathOf = (id: string) => string;

const removalOf = (statement: SymbolStatement, pathOf: PathOf): Removal | undefined => {
  if (statement.exported.base !== true) return undefined;
  const name = qualified(statement);
  if (statement.renamedFrom !== undefined) {
    const former = statement.renamedFrom;
    return statement.probably
      ? { former, how: `probably renamed to ${name}`, detail: 'found by body similarity' }
      : { former, how: `renamed to ${name}` };
  }
  if (statement.movedTo !== undefined)
    return { former: name, how: `moved to ${pathOf(statement.movedTo)}` };
  if (statement.change === 'removed') return { former: name, how: 'removed' };
  return statement.exported.head === false
    ? { former: name, how: 'no longer exported' }
    : undefined;
};

const addedHow = ({ change, movedFrom }: SymbolStatement, pathOf: PathOf): string => {
  if (change === 'added') return 'added';
  return movedFrom === undefined ? 'now exported' : `moved from ${pathOf(movedFrom)}`;
};

const isAddedExport = ({ exported }: SymbolStatement): boolean =>
  exported.base !== true && exported.head === true;

const raisesItsOwn = (statement: SymbolStatement): boolean =>
  removalOf(statement, id => id) !== undefined || isAddedExport(statement);

const unheld = (statements: ReadonlyArray<SymbolStatement>): ReadonlyArray<SymbolStatement> => {
  const holders = new Set(statements.filter(raisesItsOwn).map(qualified));
  return statements.filter(({ scope }) => scope === undefined || !holders.has(scope));
};

type Placed = {
  readonly node: string;
  readonly statement: SymbolStatement;
  readonly pathOf: PathOf;
};

const findingOf = ({ node, statement, pathOf }: Placed): Finding | undefined => {
  const removal = removalOf(statement, pathOf);
  const on = { dimension: 'api', level: 'look', target: node } as const;
  if (removal !== undefined)
    return {
      id: `api:removed:${node}#${removal.former}`,
      ...on,
      title: `${statement.kind} ${removal.former} ${removal.how}`,
      ...(removal.detail === undefined ? {} : { detail: removal.detail }),
    };
  const { signature, exported } = statement;
  const name = qualified(statement);
  if (isAddedExport(statement))
    return {
      id: `api:added:${node}#${name}`,
      ...on,
      level: 'info',
      title: `${statement.kind} ${name} ${addedHow(statement, pathOf)}`,
    };
  if (signature === undefined || exported.base !== true) return undefined;
  return {
    id: `api:signature:${node}#${name}`,
    ...on,
    title: `${statement.kind} ${name}'s signature changed`,
    detail: `${signature.base} → ${signature.head}`,
  };
};

const exportsFinding = (file: FileSymbolChanges): ReadonlyArray<Finding> => {
  const behind = new Set(
    file.symbols
      .filter(raisesItsOwn)
      .flatMap(statement => [qualified(statement), statement.renamedFrom]),
  );
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

const isLost = ({ change, kind }: LogicLine): boolean =>
  change === 'removed' && (kind === 'guard' || kind === 'catch');

const COUNTED = ['added', 'changed', 'removed'] as const;

const changedFinding = (
  node: string,
  statement: SymbolStatement,
  others: ReadonlyArray<LogicLine>,
): ReadonlyArray<Finding> => {
  if (others.length === 0) return [];
  const name = qualified(statement);
  const counts = COUNTED.map(
    change => [change, others.filter(line => line.change === change).length] as const,
  );
  return [
    {
      id: `logic:changed:${node}#${name}`,
      dimension: 'logic',
      level: 'info',
      target: node,
      title: `${statement.kind} ${name} changed its logic`,
      detail: counts
        .filter(([, count]) => count > 0)
        .map(([change, count]) => `${count} ${change}`)
        .join(', '),
    },
  ];
};

type DecisionOptions = { readonly node: string; readonly statement: SymbolStatement };

type IdentifiedLine = { readonly line: LogicLine; readonly id: string };

const decisionText = ({ change, base, head }: LogicLine): string =>
  (change === 'removed' ? base : head) ?? '';

export const decisionsOf = ({
  node,
  statement,
}: DecisionOptions): ReadonlyArray<IdentifiedLine> => {
  const lines = statement.logic ?? [];
  return lines.map((line, index) => {
    const text = decisionText(line);
    const before = lines
      .slice(0, index)
      .filter(other => other.change === line.change && decisionText(other) === text).length;
    return {
      line,
      id: `${node}#${qualified(statement)}#${text}${before === 0 ? '' : `#${before + 1}`}`,
    };
  });
};

const logicFindings = (node: string, statement: SymbolStatement): ReadonlyArray<Finding> => {
  const name = qualified(statement);
  const lines = statement.logic ?? [];
  return [
    ...decisionsOf({ node, statement })
      .filter(({ line }) => isLost(line))
      .map(({ line: { kind, base = '' }, id }) => ({
        id: `logic:removed:${id}`,
        dimension: 'logic' as const,
        level: 'look' as const,
        target: node,
        title: `${statement.kind} ${name} lost a ${kind}`,
        detail: base,
      })),
    ...changedFinding(
      node,
      statement,
      lines.filter(line => line.change !== 'same' && !isLost(line)),
    ),
  ];
};

type SymbolFindingsOptions = {
  readonly files: ReadonlyArray<SymbolFile>;
  readonly nodes: ReadonlyArray<GraphNode>;
};

export const symbolFindings = ({ files, nodes }: SymbolFindingsOptions): ReadonlyArray<Finding> => {
  const pathOf = (id: string) => nodes.find(node => node.id === id)?.path ?? id;
  return files.flatMap(file =>
    'unreadable' in file
      ? [
          {
            id: `structure:unreadable-symbols:${file.node}`,
            dimension: 'structure',
            level: 'info',
            target: file.node,
            title: 'symbols not read',
            detail: file.unreadable,
          },
        ]
      : [
          ...unheld(file.symbols).flatMap(
            statement => findingOf({ node: file.node, statement, pathOf }) ?? [],
          ),
          ...exportsFinding(file),
          ...file.symbols.flatMap(statement => logicFindings(file.node, statement)),
        ],
  );
};
