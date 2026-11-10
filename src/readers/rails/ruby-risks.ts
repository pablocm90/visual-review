import type { Node } from 'web-tree-sitter';
import type { Risk } from '../../core/reader.ts';
import { codeReaderOf } from '../tree-sitter.ts';

const { codeOf } = codeReaderOf(new Set(['.', '&.']));

const keyName = (key: Node): string => {
  if (key.type === 'simple_symbol') return key.text.slice(1);
  if (key.type === 'string') return key.namedChildren[0]?.text ?? '';
  return key.text;
};

const nestedKeys = (pair: Node, path: string): ReadonlyArray<string> => {
  const key = pair.childForFieldName('key');
  const value = pair.childForFieldName('value');
  if (key === null) return [];
  const named = `${path}${keyName(key)}`;
  if (value?.type !== 'array' || value.namedChildCount === 0) return [named];
  return keysIn(value.namedChildren, `${named}.`);
};

const keysIn = (written: ReadonlyArray<Node>, path: string): ReadonlyArray<string> =>
  written.flatMap(each => {
    if (each.type === 'simple_symbol') return [`${path}${each.text.slice(1)}`];
    return each.type === 'pair' ? nestedKeys(each, path) : [];
  });

const permittedKeys = (call: Node): ReadonlyArray<Risk> =>
  keysIn(call.childForFieldName('arguments')?.namedChildren ?? [], '').map(text => ({
    kind: 'permit',
    text,
  }));

type Reading = (call: Node) => ReadonlyArray<Risk>;

const asWritten =
  (kind: Risk['kind']): Reading =>
  call => [{ kind, text: codeOf(call) }];

const RAW_SQL = [
  'find_by_sql',
  'execute',
  'exec_query',
  'select_all',
  'select_value',
  'select_rows',
];

const arelSql: Reading = call =>
  call.childForFieldName('receiver')?.text === 'Arel' ? asWritten('raw-sql')(call) : [];

const RISKS = new Map<string, Reading>([
  ['permit', permittedKeys],
  ['permit!', asWritten('permit!')],
  ...RAW_SQL.map((name): [string, Reading] => [name, asWritten('raw-sql')]),
  ['sql', arelSql],
]);

export const risksIn = (body: Node): ReadonlyArray<Risk> =>
  body
    .descendantsOfType('call')
    .flatMap(call => RISKS.get(call.childForFieldName('method')?.text ?? '')?.(call) ?? []);
