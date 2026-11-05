import type { Node } from 'web-tree-sitter';
import type { Decision } from '../../core/reader.ts';

type Head = Pick<Decision, 'kind' | 'text' | 'foundByName'>;

type Read = Head & { readonly deeper: ReadonlyArray<Node> };

const fieldOf = (node: Node, field: string): Node | undefined =>
  node.childForFieldName(field) ?? undefined;

const statementsOf = (body: Node | undefined): ReadonlyArray<Node> =>
  (body?.namedChildren ?? []).filter(({ type }) => type !== 'comment');

const leavesOf = (node: Node): ReadonlyArray<Node> => {
  if (node.type === 'comment') return [];
  return node.childCount === 0 ? [node] : node.children.flatMap(leavesOf);
};

const OPENERS = new Set(['(', '[', '{']);
const CLOSERS = new Set([')', ']', '}']);

const isGapped = (leaf: Node, before: Node | undefined): boolean =>
  before !== undefined &&
  leaf.startIndex > before.endIndex &&
  !OPENERS.has(before.text) &&
  !CLOSERS.has(leaf.text);

const codeOf = (node: Node | undefined): string => {
  const leaves = node === undefined ? [] : leavesOf(node);
  const kept = leaves.filter(
    ({ text }, index) => !(text === ',' && CLOSERS.has(leaves[index + 1]?.text ?? '')),
  );
  return kept
    .map((leaf, index) => (isGapped(leaf, kept[index - 1]) ? ` ${leaf.text}` : leaf.text))
    .join('');
};

const THROWS = new Set(['raise', 'fail']);

const wordOf = (node: Node): string | undefined => {
  if (node.type === 'identifier') return node.text;
  if (node.type !== 'call' || fieldOf(node, 'receiver') !== undefined) return undefined;
  return fieldOf(node, 'method')?.text;
};

const thrownName = (raised: Node | undefined): string => {
  if (raised === undefined || raised.type === 'string') return '';
  const named = fieldOf(raised, 'method')?.text === 'new' ? fieldOf(raised, 'receiver') : raised;
  return ` ${codeOf(named)}`;
};

const NAMED_EXITS = new Set(['head', 'render', 'redirect_to']);

const beforeAndReturn = (statement: Node): Node | undefined =>
  fieldOf(statement, 'operator')?.text === 'and' && fieldOf(statement, 'right')?.type === 'return'
    ? fieldOf(statement, 'left')
    : undefined;

type Exit = Pick<Decision, 'text' | 'foundByName'>;

const namedExitOf = (statement: Node): Exit | undefined => {
  const before = beforeAndReturn(statement);
  const word = wordOf(before ?? statement);
  if (word === undefined || !NAMED_EXITS.has(word)) return undefined;
  return { text: before === undefined ? word : `${word} and return`, foundByName: true };
};

const exitOf = (statement: Node | undefined): Exit | undefined => {
  if (statement === undefined) return undefined;
  if (statement.type === 'return') return { text: 'return' };
  const word = wordOf(statement);
  if (word === undefined || !THROWS.has(word)) return namedExitOf(statement);
  return { text: `${word}${thrownName(statementsOf(fieldOf(statement, 'arguments'))[0])}` };
};

const fieldsOf = (node: Node, ...fields: ReadonlyArray<string>): ReadonlyArray<Node> =>
  fields.flatMap(field => fieldOf(node, field) ?? []);

const conditionOf = (node: Node, word: string): string =>
  `${word} ${codeOf(fieldOf(node, 'condition'))}`;

const ifOf = (text: string, deeper: ReadonlyArray<Node>): Read => ({ kind: 'if', text, deeper });

const guardOr = (branch: Read, statements: ReadonlyArray<Node>): Read => {
  const exit = exitOf(statements[0]);
  return exit === undefined
    ? branch
    : { ...exit, kind: 'guard', text: `${exit.text} ${branch.text}`, deeper: statements.slice(1) };
};

const branchedIf = (node: Node): Read =>
  ifOf(conditionOf(node, node.type), fieldsOf(node, 'consequence', 'alternative'));

const blockIf = (node: Node): Read =>
  fieldOf(node, 'alternative') === undefined
    ? guardOr(branchedIf(node), statementsOf(fieldOf(node, 'consequence')))
    : branchedIf(node);

const modifierIf = (node: Node): Read =>
  guardOr(
    ifOf(conditionOf(node, node.type.replace('_modifier', '')), fieldsOf(node, 'body')),
    fieldsOf(node, 'body'),
  );

const ternaryOf = (node: Node): Read => ({
  kind: 'ternary',
  text: `${codeOf(fieldOf(node, 'condition'))} ?`,
  deeper: fieldsOf(node, 'consequence', 'alternative'),
});

const READS = new Map<string, (node: Node) => Read>([
  ['if', blockIf],
  ['unless', blockIf],
  ['if_modifier', modifierIf],
  ['unless_modifier', modifierIf],
  ['elsif', branchedIf],
  ['conditional', ternaryOf],
]);

type Walk = { readonly depth: number };

const decisionsUnder = (walk: Walk, nodes: ReadonlyArray<Node>): ReadonlyArray<Decision> =>
  nodes.flatMap(node => {
    const read = READS.get(node.type)?.(node);
    if (read === undefined) return decisionsUnder(walk, node.namedChildren);
    const { deeper, ...head } = read;
    const depth = node.type === 'elsif' ? walk.depth - 1 : walk.depth;
    return [
      { ...head, depth, line: node.startPosition.row + 1 },
      ...decisionsUnder({ depth: depth + 1 }, deeper),
    ];
  });

export const decisionsOfMethod = (method: Node): ReadonlyArray<Decision> =>
  decisionsUnder({ depth: 0 }, method.namedChildren);
