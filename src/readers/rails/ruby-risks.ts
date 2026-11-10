import type { Node } from 'web-tree-sitter';
import type { Risk } from '../../core/reader.ts';
import { codeReaderOf } from '../tree-sitter.ts';

const { codeOf } = codeReaderOf(new Set(['.', '&.']));

const keyName = (key: Node): string => {
  if (key.type === 'simple_symbol') return key.text.slice(1);
  if (key.type === 'string') return key.namedChildren[0]?.text ?? '';
  return key.text;
};

const nestedKeys = (pair: Node, path: string): ReadonlyArray<Risk> => {
  const key = pair.childForFieldName('key');
  const value = pair.childForFieldName('value');
  if (key === null) return [];
  const named = `${path}${keyName(key)}`;
  if (value?.type !== 'array' || value.namedChildCount === 0)
    return [{ kind: 'permit', text: named }];
  return keysIn(value.namedChildren, `${named}.`);
};

const keysIn = (written: ReadonlyArray<Node>, path: string): ReadonlyArray<Risk> =>
  written.flatMap((each): ReadonlyArray<Risk> => {
    if (each.type === 'simple_symbol' || each.type === 'string')
      return [{ kind: 'permit', text: `${path}${keyName(each)}` }];
    if (each.type === 'hash') return keysIn(each.namedChildren, path);
    if (each.type === 'pair') return nestedKeys(each, path);
    return [{ kind: 'permit', text: `${path}${each.text}`, unread: true }];
  });

const permittedKeys = (call: Node): ReadonlyArray<Risk> =>
  keysIn(call.childForFieldName('arguments')?.namedChildren ?? [], '');

type Reading = (call: Node) => ReadonlyArray<Risk>;

const asWritten =
  (kind: Risk['kind']): Reading =>
  call => [{ kind, text: codeOf(call) }];

const firstArgument = (call: Node): Node | undefined =>
  call.childForFieldName('arguments')?.namedChildren[0];

const heredocBody = (beginning: Node): Node | undefined => {
  const row = beginning.startPosition.row;
  const { rootNode } = beginning.tree;
  const before = rootNode
    .descendantsOfType('heredoc_beginning')
    .filter(other => other.startPosition.row === row && other.startIndex < beginning.startIndex);
  return rootNode
    .descendantsOfType('heredoc_body')
    .filter(body => body.startIndex > beginning.endIndex)[before.length];
};

const asGiven = (node: Node | undefined): Node | undefined => {
  if (node?.type === 'heredoc_beginning') return heredocBody(node);
  if (node?.type !== 'call') return node;
  const receiver = asGiven(receiverOf(node));
  return isString(receiver) ? receiver : node;
};

const givenOf = (call: Node): Node | undefined => asGiven(firstArgument(call));

const WRITTEN = new Set(['string', 'delimited_symbol', 'heredoc_body']);

const isLiteral = (node: Node | undefined): boolean =>
  node?.type === 'simple_symbol' ||
  (WRITTEN.has(node?.type ?? '') &&
    (node?.namedChildren ?? []).every(({ type }) => type !== 'interpolation'));

const sqlDetail = (given: Node | undefined): Pick<Risk, 'detail'> => {
  if (given === undefined || !isString(given)) return {};
  return { detail: isLiteral(given) ? 'literal, no interpolation' : 'interpolated' };
};

const rawSql: Reading = call => [
  { kind: 'raw-sql', text: codeOf(call), ...sqlDetail(givenOf(call)) },
];

const RAW_SQL = [
  'find_by_sql',
  'execute',
  'exec_query',
  'select_all',
  'select_value',
  'select_rows',
];

const arelSql: Reading = call =>
  call.childForFieldName('receiver')?.text === 'Arel' ? rawSql(call) : [];

const QUERIES = ['where', 'order', 'group', 'having', 'joins', 'pluck', 'select'];

const isString = (node: Node | undefined): boolean => {
  if (node?.type === 'string' || node?.type === 'heredoc_body') return true;
  if (node?.type !== 'binary') return false;
  return ['left', 'right'].some(side => isString(node.childForFieldName(side) ?? undefined));
};

const givenAString: Reading = call => (isString(givenOf(call)) ? rawSql(call) : []);

const bareRaw: Reading = call =>
  call.childForFieldName('receiver') === null ? asWritten('html-safe')(call) : [];

const sentByName =
  (named: (call: Node) => Node | undefined): Reading =>
  call =>
    isLiteral(named(call)) ? [] : asWritten('dynamic-send')(call);

const receiverOf = (call: Node): Node | undefined =>
  call.childForFieldName('receiver') ?? undefined;

const RISKS = new Map<string, Reading>([
  ...QUERIES.map((name): [string, Reading] => [name, givenAString]),
  ['permit', permittedKeys],
  ['permit!', asWritten('permit!')],
  ...RAW_SQL.map((name): [string, Reading] => [name, rawSql]),
  ['sql', arelSql],
  ['html_safe', asWritten('html-safe')],
  ['safe_concat', asWritten('html-safe')],
  ['raw', bareRaw],
  ['send', sentByName(firstArgument)],
  ['public_send', sentByName(firstArgument)],
  ['constantize', sentByName(receiverOf)],
  ['safe_constantize', sentByName(receiverOf)],
]);

export const risksIn = (body: Node): ReadonlyArray<Risk> =>
  body
    .descendantsOfType('call')
    .flatMap(call => RISKS.get(call.childForFieldName('method')?.text ?? '')?.(call) ?? []);
