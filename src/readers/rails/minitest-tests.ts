import type { Node } from 'web-tree-sitter';
import type { ReadTest } from '../../core/test-changes.ts';
import { parseRuby } from './ruby-syntax.ts';

const testIn = (node: Node): ReadonlyArray<ReadTest> => {
  if (node.childForFieldName('method')?.text !== 'test') return [];
  const [name] = node.childForFieldName('arguments')?.namedChildren ?? [];
  return [{ kind: 'test', name: (name?.text ?? '').slice(1, -1), source: node.text }];
};

export const readMinitestTests = (text: string): ReadonlyArray<ReadTest> =>
  (parseRuby(text)?.namedChildren ?? []).flatMap<ReadTest>(node =>
    node.type === 'class'
      ? [
          {
            kind: 'heading',
            name: node.childForFieldName('name')?.text ?? '',
            children: (node.childForFieldName('body')?.namedChildren ?? []).flatMap(testIn),
          },
        ]
      : [],
  );
