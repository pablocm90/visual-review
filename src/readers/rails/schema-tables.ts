import type { Node } from 'web-tree-sitter';
import type { SchemaColumn, SchemaReader, SchemaTable } from '../../core/schema.ts';
import { NOT_SEARCHED } from './reader.ts';
import {
  argsOf,
  blockParameterOf,
  isOption,
  methodOf,
  nameOf,
  parseRuby,
  positional,
} from './ruby-syntax.ts';

const SCHEMA_FILE = /(?:^|\/)db\/(?:\w+_)?schema\.rb$/;

const NOT_COLUMNS: ReadonlySet<string> = new Set([
  'check_constraint',
  'exclusion_constraint',
  'foreign_key',
  'unique_constraint',
]);

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

const tableOf = (createTable: Node): SchemaTable => {
  const [name, ...rest] = argsOf(createTable);
  const parameter = blockParameterOf(createTable);
  const calls = (createTable.childForFieldName('block')?.descendantsOfType('call') ?? []).filter(
    call => call.childForFieldName('receiver')?.text === parameter,
  );
  return {
    name: nameOf(name),
    options: written(rest.filter(isOption)),
    columns: calls.filter(call => !NOT_COLUMNS.has(methodOf(call))).flatMap(columnsOf),
  };
};

export const railsSchema: SchemaReader = {
  holds: path =>
    SCHEMA_FILE.test(path) && !path.split('/').some(folder => NOT_SEARCHED.has(folder)),
  tables: text => {
    const program = parseRuby(text);
    if (program === undefined || program.hasError) throw new Error('Ruby syntax error');
    return program
      .descendantsOfType('call')
      .filter(call => methodOf(call) === 'create_table')
      .map(tableOf);
  },
};
