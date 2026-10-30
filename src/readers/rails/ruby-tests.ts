import type { Node } from 'web-tree-sitter';
import type { ReadTest } from '../../core/test-changes.ts';
import { parseRuby } from './ruby-syntax.ts';

const TESTS = new Set(['test', 'it', 'specify', 'example', 'scenario']);

const HEADINGS = new Set(['describe', 'context', 'feature']);

const MODULES = new Set(['constant', 'scope_resolution']);

const METADATA = new Set(['pair', 'simple_symbol']);

const JOINED_TO_A_MODULE = /^(#|::|\.)/;

const argumentsOf = (call: Node): ReadonlyArray<Node> =>
  call.childForFieldName('arguments')?.namedChildren ?? [];

const described = (argument: Node): string =>
  argument.type === 'string' ? argument.text.slice(1, -1) : argument.text;

const titleOf = (call: Node): string => {
  const [title] = argumentsOf(call);
  return title === undefined ? '' : described(title);
};

const groupOf = (call: Node): string => {
  const [first, second] = argumentsOf(call);
  if (first === undefined) return '';
  if (second === undefined || METADATA.has(second.type)) return described(first);
  const joined = MODULES.has(first.type) && JOINED_TO_A_MODULE.test(described(second));
  return `${described(first)}${joined ? '' : ' '}${described(second)}`;
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
    if (children.length === 0) return [];
    return [{ kind: 'heading', name: groupOf(child), children }];
  });

export const readRubyTests = (text: string): ReadonlyArray<ReadTest> => {
  const program = parseRuby(text);
  return program === undefined ? [] : statementsIn(program, []);
};
