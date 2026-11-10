import type { Node } from 'web-tree-sitter';
import type { Risk } from '../../core/reader.ts';

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

export const risksIn = (body: Node): ReadonlyArray<Risk> =>
  body
    .descendantsOfType('call')
    .filter(call => call.childForFieldName('method')?.text === 'permit')
    .flatMap(permittedKeys);
