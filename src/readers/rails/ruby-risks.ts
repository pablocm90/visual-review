import type { Node } from 'web-tree-sitter';
import type { Risk } from '../../core/reader.ts';

const permittedKeys = (call: Node): ReadonlyArray<Risk> =>
  (call.childForFieldName('arguments')?.namedChildren ?? [])
    .filter(({ type }) => type === 'simple_symbol')
    .map(({ text }) => ({ kind: 'permit', text: text.slice(1) }));

export const risksIn = (body: Node): ReadonlyArray<Risk> =>
  body
    .descendantsOfType('call')
    .filter(call => call.childForFieldName('method')?.text === 'permit')
    .flatMap(permittedKeys);
