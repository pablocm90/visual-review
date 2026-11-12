import { basename } from 'node:path';
import type { Node } from 'web-tree-sitter';
import type { SchemaColumn, SchemaIndex, SchemaReader, SchemaTable } from '../../core/schema.ts';
import { plural } from './inflection.ts';
import { NOT_SEARCHED } from './reader.ts';
import {
  argsOf,
  blockParameterOf,
  isOption,
  methodOf,
  nameOf,
  namesIn,
  positional,
  readRuby,
  writtenIn,
} from './ruby-syntax.ts';

const SCHEMA_FILE = /(?:^|\/)db\/(?:\w+_)?schema\.rb$/;

const NOT_COLUMNS: ReadonlySet<string> = new Set([
  'check_constraint',
  'exclusion_constraint',
  'foreign_key',
  'unique_constraint',
]);

const keyOf = (pair: Node): string => nameOf(pair.childForFieldName('key') ?? undefined);

const written = (options: ReadonlyArray<Node>): string =>
  options.map(({ text }) => text).join(', ');

const columnsOf = (call: Node): ReadonlyArray<SchemaColumn> => {
  const args = argsOf(call);
  return positional(args).map(name => ({
    name: nameOf(name),
    type: methodOf(call),
    options: written(args.filter(isOption)),
  }));
};

const indexOf = (call: Node): SchemaIndex => {
  const args = argsOf(call);
  const [columnsArg] = positional(args);
  const columns =
    columnsArg?.type === 'array' ? writtenIn(columnsArg).map(nameOf) : [nameOf(columnsArg)];
  const options = args.filter(isOption);
  const name = options.find(pair => keyOf(pair) === 'name');
  return {
    name:
      name === undefined
        ? columns.join(', ')
        : nameOf(name.childForFieldName('value') ?? undefined),
    columns,
    options: written(options.filter(pair => pair !== name)),
  };
};

const tableOf = (createTable: Node): SchemaTable => {
  const [name, ...rest] = argsOf(createTable);
  const parameter = blockParameterOf(createTable);
  const calls = (createTable.childForFieldName('block')?.descendantsOfType('call') ?? []).filter(
    call => call.childForFieldName('receiver')?.text === parameter,
  );
  return {
    name: nameOf(name),
    options: written(rest.filter(isOption)),
    columns: calls
      .filter(call => methodOf(call) !== 'index' && !NOT_COLUMNS.has(methodOf(call)))
      .flatMap(columnsOf),
    indexes: calls.filter(call => methodOf(call) === 'index').map(indexOf),
  };
};

const assignedTo = (program: Node, method: string): ReadonlyArray<Node> =>
  program.descendantsOfType(['assignment', 'operator_assignment']).flatMap(assignment => {
    const left = assignment.childForFieldName('left');
    const right = assignment.childForFieldName('right');
    return left !== null && right !== null && methodOf(left) === method ? [right] : [];
  });

const listOf = (assigned: Node): Node => assigned.childForFieldName('receiver') ?? assigned;

const tablesNamedBy = (path: string): ReadonlyArray<string> => {
  const table = plural(basename(path, '.rb'));
  const folders = (path.split('/models/').at(-1) ?? '').split('/').slice(0, -1);
  return folders.length === 0 ? [table] : [table, [...folders, table].join('_')];
};

export const railsSchema: SchemaReader = {
  holds: path =>
    SCHEMA_FILE.test(path) && !path.split('/').some(folder => NOT_SEARCHED.has(folder)),
  tables: text =>
    readRuby(text, program => {
      if (program.hasError) throw new Error('Ruby syntax error');
      return program
        .descendantsOfType('call')
        .filter(call => methodOf(call) === 'create_table')
        .map(tableOf);
    }),
  ignored: ({ path, text }) =>
    readRuby(text, program => {
      const [named] = assignedTo(program, 'table_name');
      const tables = named === undefined ? tablesNamedBy(path) : [nameOf(named)];
      return assignedTo(program, 'ignored_columns').flatMap(list =>
        namesIn(listOf(list)).flatMap(column => tables.map(table => ({ table, column }))),
      );
    }),
};
