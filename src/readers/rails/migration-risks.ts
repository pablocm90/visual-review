import type { Node } from 'web-tree-sitter';
import type { MigrationReader, MigrationRisk } from '../../core/migration.ts';
import { parseRuby } from './ruby-syntax.ts';

const STILL_READ = 'Code still running during the deploy may read it.';

type Risky = Omit<MigrationRisk, 'line'>;

type Rule = (call: {
  readonly table: string;
  readonly args: ReadonlyArray<Node>;
}) => ReadonlyArray<Risky>;

const nameOf = (node: Node | undefined): string => node?.text.replace(/^:?['"]?|['"]$/g, '') ?? '';

const callsIn = (node: Node): ReadonlyArray<Node> => [
  ...(node.type === 'call' ? [node] : []),
  ...node.namedChildren.flatMap(callsIn),
];

const isOption = ({ type }: Node): boolean => type === 'pair' || type === 'hash';

const stillRead = (title: string): Risky => ({ title, why: STILL_READ });

const removed = (word: string, table: string, name: Node | undefined): Risky =>
  stillRead(`${word} ${table}.${nameOf(name)} removed`);

const RULES: ReadonlyMap<string, Rule> = new Map<string, Rule>([
  ['remove_column', ({ table, args }) => [removed('column', table, args[0])]],
  [
    'remove_columns',
    ({ table, args }) =>
      args.filter(arg => !isOption(arg)).map(column => removed('column', table, column)),
  ],
  ['remove_reference', ({ table, args }) => [removed('reference', table, args[0])]],
  ['remove_belongs_to', ({ table, args }) => [removed('reference', table, args[0])]],
  ['remove_timestamps', ({ table }) => [stillRead(`timestamps of ${table} removed`)]],
  [
    'rename_column',
    ({ table, args: [from, to] }) => [
      stillRead(`column ${table}.${nameOf(from)} renamed to ${nameOf(to)}`),
    ],
  ],
]);

const risksOf = (call: Node): ReadonlyArray<MigrationRisk> => {
  const rule = RULES.get(call.childForFieldName('method')?.text ?? '');
  const [table, ...args] = call.childForFieldName('arguments')?.namedChildren ?? [];
  if (rule === undefined || table === undefined) return [];
  return rule({ table: nameOf(table), args }).map(risky => ({
    ...risky,
    line: call.startPosition.row + 1,
  }));
};

export const railsMigrations: MigrationReader = {
  holds: () => false,
  risks: text => {
    const program = parseRuby(text);
    return program === undefined ? [] : callsIn(program).flatMap(risksOf);
  },
};
