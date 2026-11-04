import type { Node } from 'web-tree-sitter';
import type { MigrationReader, MigrationRisk } from '../../core/migration.ts';
import { parseRuby } from './ruby-syntax.ts';

const STILL_READ = 'Code still running during the deploy may read it.';

type Risky = Omit<MigrationRisk, 'line'>;

type Rule = (call: {
  readonly table: string;
  readonly args: ReadonlyArray<Node>;
}) => ReadonlyArray<Risky>;

const REWRITES =
  'A type change can rewrite the table under a lock, and running code expects the old type.';

const SCANS = 'Fails if a row holds NULL, and scans the table under a lock.';

const NO_VALUE = 'Fails on a table with rows.';

const BLOCKS_WRITES = 'Blocks writes to the table while the index builds.';

const nameOf = (node: Node | undefined): string => node?.text.replace(/^:?['"]?|['"]$/g, '') ?? '';

const namesOf = (node: Node | undefined): string =>
  node?.type === 'array' ? node.namedChildren.map(nameOf).join(', ') : nameOf(node);

const callsIn = (node: Node): ReadonlyArray<Node> => [
  ...(node.type === 'call' ? [node] : []),
  ...node.namedChildren.flatMap(callsIn),
];

const isOption = ({ type }: Node): boolean => type === 'pair' || type === 'hash';

const pairsOf = (arg: Node): ReadonlyArray<Node> => {
  if (arg.type === 'pair') return [arg];
  return arg.type === 'hash' ? arg.namedChildren : [];
};

const optionOf = (args: ReadonlyArray<Node>, key: string): Node | undefined =>
  args
    .flatMap(pairsOf)
    .find(pair => nameOf(pair.childForFieldName('key') ?? undefined) === key)
    ?.childForFieldName('value') ?? undefined;

const leavesRowsEmpty = (args: ReadonlyArray<Node>, nullDefault: string): boolean => {
  const fallback = optionOf(args, 'default');
  const required = (optionOf(args, 'null')?.type ?? nullDefault) === 'false';
  return required && (fallback === undefined || fallback.type === 'nil');
};

const addedRequired = (what: string): Risky => ({
  title: `${what} added as null: false with no default`,
  why: NO_VALUE,
});

const stillRead = (title: string): Risky => ({ title, why: STILL_READ });

const removed = (word: string, table: string, name: Node | undefined): Risky =>
  stillRead(`${word} ${table}.${nameOf(name)} removed`);

const addedReference: Rule = ({ table, args }) =>
  leavesRowsEmpty(args, 'true') ? [addedRequired(`reference ${table}.${nameOf(args[0])}`)] : [];

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
  [
    'change_column',
    ({ table, args: [column, type] }) => [
      { title: `column ${table}.${nameOf(column)} changed to ${nameOf(type)}`, why: REWRITES },
    ],
  ],
  [
    'change_column_null',
    ({ table, args: [column, allowed] }) =>
      allowed?.type === 'true'
        ? []
        : [{ title: `column ${table}.${nameOf(column)} set to null: false`, why: SCANS }],
  ],
]);

const RULES_NEEDING_ROWS: ReadonlyMap<string, Rule> = new Map<string, Rule>([
  [
    'add_column',
    ({ table, args }) =>
      leavesRowsEmpty(args, 'true') ? [addedRequired(`column ${table}.${nameOf(args[0])}`)] : [],
  ],
  ['add_reference', addedReference],
  ['add_belongs_to', addedReference],
  [
    'add_timestamps',
    ({ table, args }) =>
      leavesRowsEmpty(args, 'false') ? [addedRequired(`timestamps of ${table}`)] : [],
  ],
  [
    'add_index',
    ({ table, args }) =>
      optionOf(args, 'algorithm')?.text === ':concurrently'
        ? []
        : [
            {
              title: `index on ${table} (${namesOf(args[0])}) added, not concurrently`,
              why: BLOCKS_WRITES,
            },
          ],
  ],
]);

const methodOf = (call: Node): string => call.childForFieldName('method')?.text ?? '';

const argsOf = (call: Node): ReadonlyArray<Node> =>
  call.childForFieldName('arguments')?.namedChildren ?? [];

const risksOf =
  (newTables: ReadonlySet<string>) =>
  (call: Node): ReadonlyArray<MigrationRisk> => {
    const [tableArg, ...args] = argsOf(call);
    if (tableArg === undefined) return [];
    const table = nameOf(tableArg);
    const rule =
      RULES.get(methodOf(call)) ??
      (newTables.has(table) ? undefined : RULES_NEEDING_ROWS.get(methodOf(call)));
    return (rule?.({ table, args }) ?? []).map(risky => ({
      ...risky,
      line: call.startPosition.row + 1,
    }));
  };

export const railsMigrations: MigrationReader = {
  holds: () => false,
  risks: text => {
    const program = parseRuby(text);
    if (program === undefined) return [];
    const calls = callsIn(program);
    const newTables = new Set(
      calls.filter(call => methodOf(call) === 'create_table').map(call => nameOf(argsOf(call)[0])),
    );
    return calls.flatMap(risksOf(newTables));
  },
};
