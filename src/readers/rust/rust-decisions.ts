import type { Node } from 'web-tree-sitter';
import type { Decision } from '../../core/reader.ts';
import { codeReaderOf, isComment } from '../tree-sitter.ts';

type Head = Pick<Decision, 'kind' | 'text' | 'foundByName'>;

const { codeOf, codeUpTo } = codeReaderOf(new Set(['.']));

type Read = Head & {
  readonly deeper: ReadonlyArray<Node>;
  readonly beside?: ReadonlyArray<Node>;
};

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
    deeper: leadingExitOf(alternative)?.deeper ?? [alternative],
  };
};

const firstAlternativeOf = (pattern: Node | undefined): Node | undefined =>
  pattern?.type === 'or_pattern' ? firstAlternativeOf(pattern.namedChildren[0]) : pattern;

const armOf = (node: Node): Read => {
  const value = fieldOf(node, 'value');
  const pattern = firstAlternativeOf(fieldOf(node, 'pattern')?.namedChildren[0]);
  return {
    kind: isErrPattern(pattern) ? 'catch' : 'case',
    text: codeUpTo(node, value),
    deeper: value === undefined ? [] : [value],
  };
};

const loopOf = (node: Node): Read => ({
  kind: 'loop',
  text: codeUpTo(node, fieldOf(node, 'body')),
  deeper: fieldsOf(node, 'body'),
});

const LOGICALS: ReadonlySet<string> = new Set(['&&', '||']);

const logicalOf = (node: Node): Read | undefined => {
  const operator = fieldOf(node, 'operator')?.text ?? '';
  if (!LOGICALS.has(operator)) return undefined;
  return {
    kind: 'logical',
    text: `${codeOf(fieldOf(node, 'left'))} ${operator}`,
    deeper: fieldsOf(node, 'right'),
  };
};

const returnOf = (node: Node, walk: Walk): Read | undefined =>
  walk.depth > 0 ? { kind: 'return', text: 'return', deeper: node.namedChildren } : undefined;

const tryOf = (node: Node): Read => ({
  kind: 'try',
  text: codeOf(node),
  deeper: [],
  beside: node.namedChildren,
});

const COMMAS_KEPT = new Map([
  ['ensure', 0],
  ['assert', 0],
  ['assert_eq', 1],
  ['assert_ne', 1],
]);

const THROWS: ReadonlySet<string> = new Set([
  'bail',
  'panic',
  'unreachable',
  'todo',
  'unimplemented',
]);

const macroOf = (node: Node): Read | undefined => {
  const name = macroNameOf(node) ?? '';
  if (THROWS.has(name)) return { kind: 'throw', text: `${name}!`, foundByName: true, deeper: [] };
  const kept = COMMAS_KEPT.get(name);
  const tokens = node.lastNamedChild;
  if (kept === undefined || tokens === null) return undefined;
  const end = tokens.children.filter(({ type }) => type === ',')[kept];
  const close = end === undefined ? '' : tokens.lastChild?.text;
  return {
    kind: 'guard',
    text: `${name}!${codeUpTo(tokens, end)}${close}`,
    foundByName: true,
    deeper: [],
  };
};

const READS = new Map<string, (node: Node, walk: Walk) => Read | undefined>([
  ['if_expression', ifOf],
  ['let_declaration', letElseOf],
  ['macro_invocation', macroOf],
  ['match_arm', armOf],
  ['for_expression', loopOf],
  ['while_expression', loopOf],
  ['loop_expression', loopOf],
  ['binary_expression', logicalOf],
  ['return_expression', returnOf],
  ['try_expression', tryOf],
]);

const decisionsUnder = (walk: Walk, nodes: ReadonlyArray<Node>): ReadonlyArray<Decision> =>
  nodes.flatMap(node => {
    const read = READS.get(node.type)?.(node, walk);
    if (read === undefined) return decisionsUnder(walk, node.namedChildren);
    const { deeper, beside = [], ...head } = read;
    const depth = isElseIf(node) ? walk.depth - 1 : walk.depth;
    return [
      ...decisionsUnder(walk, beside),
      { ...head, depth, line: node.startPosition.row + 1 },
      ...decisionsUnder({ depth: depth + 1 }, deeper),
    ];
  });

export const decisionsOfFunction = (item: Node): ReadonlyArray<Decision> =>
  decisionsUnder({ depth: 0 }, fieldsOf(item, 'body'));
