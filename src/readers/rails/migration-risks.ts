import type { Node } from 'web-tree-sitter';
import type { MigrationReader, MigrationRisk } from '../../core/migration.ts';
import { NOT_SEARCHED } from './reader.ts';
import {
  argsOf,
  blockParameterOf,
  methodOf,
  nameOf,
  parseRuby,
  positional,
  writtenIn,
} from './ruby-syntax.ts';

const STILL_READ = 'Code still running during the deploy may read it.';

type Risky = Omit<MigrationRisk, 'line'>;

type Rule = (call: {
  readonly table: string;
  readonly args: ReadonlyArray<Node>;
}) => ReadonlyArray<Risky>;

const MIGRATION_FILE = /(?:^|\/)db\/(?:\w+_)?migrate\/(?:.*\/)?(\d+)_[^/]*\.rb$/;

const REWRITES =
  'A type change can rewrite the table under a lock, and running code expects the old type.';

const SCANS = 'Fails if a row holds NULL, and scans the table under a lock.';

const NO_VALUE = 'Fails on a table with rows.';

const BLOCKS_WRITES = 'Blocks writes to the table while the index builds.';

const LISTS: ReadonlySet<string> = new Set(['array', 'symbol_array', 'string_array']);

const namesOf = (node: Node | undefined): string =>
  node !== undefined && LISTS.has(node.type)
    ? writtenIn(node).map(nameOf).join(', ')
    : nameOf(node);

const DOWN_FIELD: ReadonlyMap<string, string> = new Map([
  ['method', 'name'],
  ['singleton_method', 'name'],
  ['call', 'method'],
]);

const BACKWARDS: ReadonlySet<string | undefined> = new Set(['down', 'revert']);

const runsBackwards = (node: Node): boolean =>
  BACKWARDS.has(node.childForFieldName(DOWN_FIELD.get(node.type) ?? '')?.text);

const callsIn = (node: Node): ReadonlyArray<Node> =>
  runsBackwards(node)
    ? []
    : [...(node.type === 'call' ? [node] : []), ...node.namedChildren.flatMap(callsIn)];

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

const removesEach =
  (word: string): Rule =>
  ({ table, args }) =>
    positional(args).map(name => removed(word, table, name));

const addsEach =
  (word: string): Rule =>
  ({ table, args }) =>
    leavesRowsEmpty(args, 'true')
      ? positional(args).map(name => addedRequired(`${word} ${table}.${nameOf(name)}`))
      : [];

const removesTimestamps: Rule = ({ table }) => [stillRead(`timestamps of ${table} removed`)];

const renames: Rule = ({ table, args: [from, to] }) => [
  stillRead(`column ${table}.${nameOf(from)} renamed to ${nameOf(to)}`),
];

const changesType: Rule = ({ table, args: [column, type] }) => [
  { title: `column ${table}.${nameOf(column)} changed to ${nameOf(type)}`, why: REWRITES },
];

const changesNull: Rule = ({ table, args: [column, allowed] }) =>
  allowed?.type === 'true'
    ? []
    : [{ title: `column ${table}.${nameOf(column)} set to null: false`, why: SCANS }];

const addsColumn: Rule = ({ table, args }) =>
  leavesRowsEmpty(args, 'true') ? [addedRequired(`column ${table}.${nameOf(args[0])}`)] : [];

const addsTimestamps: Rule = ({ table, args }) =>
  leavesRowsEmpty(args, 'false') ? [addedRequired(`timestamps of ${table}`)] : [];

const indexAdded = (table: string, columns: string): Risky => ({
  title: `index on ${table} (${columns}) added, not concurrently`,
  why: BLOCKS_WRITES,
});

const concurrent = (args: ReadonlyArray<Node>): boolean =>
  optionOf(args, 'algorithm')?.text === ':concurrently';

const addsIndex: Rule = ({ table, args }) =>
  concurrent(args) ? [] : [indexAdded(table, namesOf(args[0]))];

const OFF: ReadonlySet<string> = new Set(['false', 'nil']);

const indexBlocksWrites = (args: ReadonlyArray<Node>, byDefault: boolean): boolean => {
  const index = optionOf(args, 'index');
  if (index === undefined) return byDefault;
  return !OFF.has(index.type) && !concurrent([index]);
};

const referenceColumns = (name: Node, args: ReadonlyArray<Node>): string => {
  if (name.type === 'splat_argument') return name.text;
  const polymorphic = optionOf(args, 'polymorphic');
  const id = `${nameOf(name)}_id`;
  return polymorphic === undefined || OFF.has(polymorphic.type)
    ? id
    : `${nameOf(name)}_type, ${id}`;
};

const indexesReference: Rule = ({ table, args }) =>
  indexBlocksWrites(args, true)
    ? positional(args).map(name => indexAdded(table, referenceColumns(name, args)))
    : [];

const addsReference: Rule = call => [...addsEach('reference')(call), ...indexesReference(call)];

const indexesColumns =
  (names: ReadonlyArray<Node>): Rule =>
  ({ table, args }) =>
    indexBlocksWrites(args, false) ? names.map(name => indexAdded(table, nameOf(name))) : [];

const addsColumnOfType: Rule = call => [
  ...addsEach('column')(call),
  ...indexesColumns(positional(call.args))(call),
];

const addsNamedColumn: Rule = call => [
  ...addsColumn(call),
  ...indexesColumns(call.args.slice(0, 1))(call),
];

const RULES: ReadonlyMap<string, Rule> = new Map<string, Rule>([
  ['remove_column', ({ table, args }) => [removed('column', table, args[0])]],
  ['remove_columns', removesEach('column')],
  ['remove_reference', removesEach('reference')],
  ['remove_belongs_to', removesEach('reference')],
  ['remove_timestamps', removesTimestamps],
  ['rename_column', renames],
  ['change_column', changesType],
]);

const RULES_NEEDING_ROWS: ReadonlyMap<string, Rule> = new Map<string, Rule>([
  ['change_column_null', changesNull],
  ['add_column', addsColumn],
  ['add_reference', addsReference],
  ['add_belongs_to', addsReference],
  ['add_timestamps', addsTimestamps],
  ['add_index', addsIndex],
]);

const CHANGE_TABLE_RULES: ReadonlyMap<string, Rule> = new Map<string, Rule>([
  ['remove', removesEach('column')],
  ['remove_references', removesEach('reference')],
  ['remove_belongs_to', removesEach('reference')],
  ['remove_timestamps', removesTimestamps],
  ['rename', renames],
  ['change', changesType],
]);

const CHANGE_TABLE_RULES_NEEDING_ROWS: ReadonlyMap<string, Rule> = new Map<string, Rule>([
  ['change_null', changesNull],
  ['column', addsNamedColumn],
  ['references', addsReference],
  ['belongs_to', addsReference],
  ['timestamps', addsTimestamps],
  ['index', addsIndex],
]);

const enclosing = ({ parent }: Node): ReadonlyArray<Node> =>
  parent === null ? [] : [parent, ...enclosing(parent)];

const changeTableOf = (call: Node): Node | undefined => {
  const receiver = call.childForFieldName('receiver')?.text;
  return receiver === undefined
    ? undefined
    : enclosing(call).find(
        outer => methodOf(outer) === 'change_table' && blockParameterOf(outer) === receiver,
      );
};

const ruleOutsideBlock = (method: string, hasRows: boolean): Rule | undefined =>
  RULES.get(method) ?? (hasRows ? RULES_NEEDING_ROWS.get(method) : undefined);

const ruleInChangeTable = (method: string, hasRows: boolean): Rule | undefined =>
  CHANGE_TABLE_RULES.get(method) ??
  (hasRows ? (CHANGE_TABLE_RULES_NEEDING_ROWS.get(method) ?? addsColumnOfType) : undefined);

const placeOf = (call: Node) => {
  const block = changeTableOf(call);
  const [first, ...rest] = argsOf(call);
  return block === undefined
    ? { tableArg: first, args: rest, ruleOf: ruleOutsideBlock }
    : { tableArg: argsOf(block)[0], args: argsOf(call), ruleOf: ruleInChangeTable };
};

const risksOf =
  (newTables: ReadonlySet<string>) =>
  (call: Node): ReadonlyArray<MigrationRisk> => {
    const { tableArg, args, ruleOf } = placeOf(call);
    if (tableArg === undefined) return [];
    const table = nameOf(tableArg);
    const rule = ruleOf(methodOf(call), !newTables.has(table));
    return (rule?.({ table, args }) ?? []).map(risky => ({
      ...risky,
      line: call.startPosition.row + 1,
    }));
  };

export const railsMigrations: MigrationReader = {
  holds: path =>
    MIGRATION_FILE.test(path) && !path.split('/').some(folder => NOT_SEARCHED.has(folder)),
  version: path => MIGRATION_FILE.exec(path)?.[1],
  risks: text => {
    const program = parseRuby(text);
    if (program === undefined || program.hasError) throw new Error('Ruby syntax error');
    const calls = callsIn(program);
    const newTables = new Set(
      calls.filter(call => methodOf(call) === 'create_table').map(call => nameOf(argsOf(call)[0])),
    );
    return calls.flatMap(risksOf(newTables));
  },
};
