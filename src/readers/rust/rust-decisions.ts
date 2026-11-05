import type { Node } from 'web-tree-sitter';
import type { Decision } from '../../core/reader.ts';
import { codeReaderOf, isComment } from '../tree-sitter.ts';

type Head = Pick<Decision, 'kind' | 'text' | 'foundByName'>;

const { codeOf, codeUpTo } = codeReaderOf(new Set(['.']));

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

type Exit = Pick<Read, 'foundByName' | 'deeper'>;

const leadingExitOf = (block: Node | undefined): Exit | undefined => {
  const first = exprOf(block?.namedChildren.find(node => !isComment(node)));
  if (first?.type === 'return_expression') return { deeper: first.namedChildren };
  return macroNameOf(first) === 'bail' ? { foundByName: true, deeper: [] } : undefined;
};

const isElseIf = (node: Node): boolean => node.parent?.type === 'else_clause';

const isErrPattern = (pattern: Node | undefined): boolean =>
  pattern !== undefined && fieldOf(pattern, 'type')?.text.split('::').at(-1) === 'Err';

const isErrCondition = (condition: Node | undefined): boolean =>
  condition?.type === 'let_condition' && isErrPattern(fieldOf(condition, 'pattern'));

const ifOf = (node: Node): Read => {
  const code = codeOf(fieldOf(node, 'condition'));
  const condition = isElseIf(node) ? `else if ${code}` : `if ${code}`;
  const exit =
    fieldOf(node, 'alternative') === undefined && !isElseIf(node)
      ? leadingExitOf(fieldOf(node, 'consequence'))
      : undefined;
  return exit === undefined
    ? {
        kind: isErrCondition(fieldOf(node, 'condition')) ? 'catch' : 'if',
        text: condition,
        deeper: fieldsOf(node, 'consequence', 'alternative'),
      }
    : { ...exit, kind: 'guard', text: `${condition} return` };
};

const letElseOf = (node: Node): Read | undefined => {
  const alternative = fieldOf(node, 'alternative');
  if (alternative === undefined) return undefined;
  return {
    kind: 'guard',
    text: codeUpTo(node, alternative),
    deeper: [alternative],
  };
};

const READS = new Map<string, (node: Node) => Read | undefined>([
  ['if_expression', ifOf],
  ['let_declaration', letElseOf],
]);

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
