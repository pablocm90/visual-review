import type { Node } from 'web-tree-sitter';
import type { ReadTest } from '../../core/test-changes.ts';
import { parseRuby } from './ruby-syntax.ts';

const TESTS = new Set(['test', 'it']);

const HEADINGS = new Set(['describe', 'context']);

const titleOf = (call: Node): string => {
  const [title] = call.childForFieldName('arguments')?.namedChildren ?? [];
  if (title === undefined) return '';
  return title.type === 'string' ? title.text.slice(1, -1) : title.text;
};

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
    const method = child.childForFieldName('method')?.text ?? '';
    if (TESTS.has(method)) return [{ kind: 'test', name: titleOf(child), source: child.text }];
    if (!HEADINGS.has(method)) return statementsIn(child, scope);
    const block = child.childForFieldName('block');
    const children = block === null ? [] : statementsIn(block, []);
    return [{ kind: 'heading', name: titleOf(child), children }];
  });

export const readRubyTests = (text: string): ReadonlyArray<ReadTest> => {
  const program = parseRuby(text);
  return program === undefined ? [] : statementsIn(program, []);
};
