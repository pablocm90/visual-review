import type { Node } from 'web-tree-sitter';
import type { Decision } from '../../core/reader.ts';

const exprOf = (statement: Node | undefined): Node | undefined =>
  statement?.type === 'expression_statement' ? statement.namedChildren[0] : statement;

const macroNameOf = (node: Node | undefined): string | undefined =>
  node?.type === 'macro_invocation'
    ? node.childForFieldName('macro')?.text.split('::').at(-1)
    : undefined;

type Exit = Pick<Decision, 'foundByName'>;

const exitOf = (statement: Node | undefined): Exit | undefined => {
  const expr = exprOf(statement);
  if (expr?.type === 'return_expression') return {};
  return macroNameOf(expr) === 'bail' ? { foundByName: true } : undefined;
};

const decisionsUnder = (nodes: ReadonlyArray<Node>): ReadonlyArray<Decision> =>
  nodes.flatMap(node => {
    const exit =
      node.type === 'if_expression'
        ? exitOf(node.childForFieldName('consequence')?.namedChildren[0])
        : undefined;
    return exit === undefined
      ? decisionsUnder(node.namedChildren)
      : [
          {
            ...exit,
            kind: 'guard' as const,
            text: `if ${node.childForFieldName('condition')?.text} return`,
            depth: 0,
            line: node.startPosition.row + 1,
          },
        ];
  });

export const decisionsOfFunction = (item: Node): ReadonlyArray<Decision> =>
  decisionsUnder([item.childForFieldName('body') ?? []].flat());
