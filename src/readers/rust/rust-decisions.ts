import type { Node } from 'web-tree-sitter';
import type { Decision } from '../../core/reader.ts';

const exprOf = (statement: Node | undefined): Node | undefined =>
  statement?.type === 'expression_statement' ? statement.namedChildren[0] : statement;

const returnsFirst = (node: Node): boolean =>
  exprOf(node.childForFieldName('consequence')?.namedChildren[0])?.type === 'return_expression';

const decisionsUnder = (nodes: ReadonlyArray<Node>): ReadonlyArray<Decision> =>
  nodes.flatMap(node =>
    node.type === 'if_expression' && returnsFirst(node)
      ? [
          {
            kind: 'guard' as const,
            text: `if ${node.childForFieldName('condition')?.text} return`,
            depth: 0,
            line: node.startPosition.row + 1,
          },
        ]
      : decisionsUnder(node.namedChildren),
  );

export const decisionsOfFunction = (item: Node): ReadonlyArray<Decision> =>
  decisionsUnder([item.childForFieldName('body') ?? []].flat());
