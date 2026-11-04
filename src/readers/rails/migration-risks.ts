import type { Node } from 'web-tree-sitter';
import type { MigrationReader, MigrationRisk } from '../../core/migration.ts';
import { parseRuby } from './ruby-syntax.ts';

const STILL_READ = 'Code still running during the deploy may read it.';

const nameOf = (node: Node | undefined): string => node?.text.replace(/^:?['"]?|['"]$/g, '') ?? '';

const callsIn = (node: Node): ReadonlyArray<Node> => [
  ...(node.type === 'call' ? [node] : []),
  ...node.namedChildren.flatMap(callsIn),
];

const risksOf = (call: Node): ReadonlyArray<MigrationRisk> => {
  if (call.childForFieldName('method')?.text !== 'remove_column') return [];
  const [table, column] = call.childForFieldName('arguments')?.namedChildren ?? [];
  return [
    {
      title: `column ${nameOf(table)}.${nameOf(column)} removed`,
      why: STILL_READ,
      line: call.startPosition.row + 1,
    },
  ];
};

export const railsMigrations: MigrationReader = {
  holds: () => false,
  risks: text => {
    const program = parseRuby(text);
    return program === undefined ? [] : callsIn(program).flatMap(risksOf);
  },
};
