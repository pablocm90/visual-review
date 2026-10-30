import type { Node } from 'web-tree-sitter';
import type { ReadTest } from '../../core/test-changes.ts';
import { parseRuby } from './ruby-syntax.ts';

const statementsIn = (node: Node, scope: ReadonlyArray<string>): ReadonlyArray<ReadTest> =>
  node.namedChildren.flatMap<ReadTest>(child => {
    const name = child.childForFieldName('name')?.text ?? '';
    const body = child.childForFieldName('body');
    if (child.type === 'module') return body === null ? [] : statementsIn(body, [...scope, name]);
    if (child.type === 'class') {
      const children = body === null ? [] : statementsIn(body, []);
      if (children.length === 0) return [];
      return [{ kind: 'heading', name: [...scope, name].join('::'), children }];
    }
    if (child.type === 'method' && name.startsWith('test_')) {
      return [{ kind: 'test', name, source: child.text }];
    }
    if (child.childForFieldName('method')?.text !== 'test') return statementsIn(child, scope);
    const [title] = child.childForFieldName('arguments')?.namedChildren ?? [];
    return [{ kind: 'test', name: (title?.text ?? '').slice(1, -1), source: child.text }];
  });

export const readMinitestTests = (text: string): ReadonlyArray<ReadTest> => {
  const program = parseRuby(text);
  return program === undefined ? [] : statementsIn(program, []);
};
