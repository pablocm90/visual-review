import type { Node } from 'web-tree-sitter';
import type { ReadTest } from '../../core/test-changes.ts';
import { attributeOf, isCfgTest, itemsIn, parseRust } from './rust-syntax.ts';

const pathOf = (item: Node) => attributeOf(item)?.namedChildren[0]?.text;

const isTestAttribute = (item: Node): boolean => pathOf(item)?.split('::').at(-1) === 'test';

const isIgnore = (item: Node): boolean => pathOf(item) === 'ignore';

const spaced = (name: string | undefined): string => (name ?? '').replaceAll('_', ' ');

export const readRustTests = (text: string): ReadonlyArray<ReadTest> => {
  const statementsIn = (list: Node): ReadonlyArray<ReadTest> =>
    itemsIn(list).flatMap<ReadTest>(({ node, attributes }) => {
      const name = spaced(node.childForFieldName('name')?.text);
      if (attributes.some(isTestAttribute)) {
        const source = [...attributes, node].map(part => part.text).join('\n');
        const label = attributes.some(isIgnore) ? 'skip' : undefined;
        return [{ kind: 'test', name, label, source }];
      }
      const body = node.childForFieldName('body');
      if (body === null) return [];
      const children = statementsIn(body);
      if (attributes.some(isCfgTest)) return children;
      return children.length === 0 ? [] : [{ kind: 'heading', name, children }];
    });
  const root = parseRust(text);
  return root === undefined ? [] : statementsIn(root);
};
