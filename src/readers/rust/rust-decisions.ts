import type { Node } from 'web-tree-sitter';
import type { Decision } from '../../core/reader.ts';
import { codeReaderOf, isComment } from '../tree-sitter.ts';

type Head = Pick<Decision, 'kind' | 'text' | 'foundByName'>;

const { codeOf } = codeReaderOf(new Set(['.']));

type Read = Head & { readonly deeper: ReadonlyArray<Node> };

type Walk = { readonly depth: number };

const fieldOf = (node: Node, field: string): Node | undefined =>
  node.childForFieldName(field) ?? undefined;

const fieldsOf = (node: Node, ...fields: ReadonlyArray<string>): ReadonlyArray<Node> =>
  fields.flatMap(field => fieldOf(node, field) ?? []);

const exprOf = (statement: Node | undefined): Node | undefined =>
  statement?.type === 'expression_statement' ? statement.namedChildren[0] : statement;

const macroNameOf = (node: Node | undefined): string | undefined =>
  node?.childForFieldName('macro')?.text.split('::').at(-1);

type Exit = Pick<Decision, 'foundByName'>;

const exitOf = (expr: Node | undefined): Exit | undefined => {
  if (expr?.type === 'return_expression') return {};
  return macroNameOf(expr) === 'bail' ? { foundByName: true } : undefined;
};

const firstStatementOf = (block: Node | undefined): Node | undefined =>
  block?.namedChildren.find(node => !isComment(node));

const isElseIf = (node: Node): boolean => node.parent?.type === 'else_clause';

const ifOf = (node: Node): Read => {
  const code = codeOf(fieldOf(node, 'condition'));
  const condition = isElseIf(node) ? `else if ${code}` : `if ${code}`;
  const first =
    fieldOf(node, 'alternative') === undefined && !isElseIf(node)
      ? exprOf(firstStatementOf(fieldOf(node, 'consequence')))
      : undefined;
  const exit = exitOf(first);
  return exit === undefined
    ? { kind: 'if', text: condition, deeper: fieldsOf(node, 'consequence', 'alternative') }
    : { ...exit, kind: 'guard', text: `${condition} return`, deeper: first?.namedChildren ?? [] };
};

const READS = new Map<string, (node: Node) => Read>([['if_expression', ifOf]]);

const decisionsUnder = (walk: Walk, nodes: ReadonlyArray<Node>): ReadonlyArray<Decision> =>
  nodes.flatMap(node => {
    const read = READS.get(node.type)?.(node);
    if (read === undefined) return decisionsUnder(walk, node.namedChildren);
    const { deeper, ...head } = read;
    const depth = isElseIf(node) ? walk.depth - 1 : walk.depth;
    return [
      { ...head, depth, line: node.startPosition.row + 1 },
      ...decisionsUnder({ depth: depth + 1 }, deeper),
    ];
  });

export const decisionsOfFunction = (item: Node): ReadonlyArray<Decision> =>
  decisionsUnder({ depth: 0 }, fieldsOf(item, 'body'));
