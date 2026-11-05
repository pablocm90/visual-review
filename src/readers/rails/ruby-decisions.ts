import type { Node } from 'web-tree-sitter';
import type { Decision } from '../../core/reader.ts';

type Head = Pick<Decision, 'kind' | 'text'>;

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

const exitOf = (statement: Node | undefined): string | undefined => {
  if (statement === undefined) return undefined;
  if (statement.type === 'return') return 'return';
  const word = wordOf(statement);
  if (word === undefined || !THROWS.has(word)) return undefined;
  return `${word}${thrownName(statementsOf(fieldOf(statement, 'arguments'))[0])}`;
};

const guardOf = (node: Node, word: string, opening: Node | undefined): Read | undefined => {
  const exit = exitOf(opening);
  return exit === undefined
    ? undefined
    : { kind: 'guard', text: `${exit} ${word} ${codeOf(fieldOf(node, 'condition'))}`, deeper: [] };
};

const blockIf = (node: Node): Read | undefined =>
  fieldOf(node, 'alternative') === undefined
    ? guardOf(node, node.type, statementsOf(fieldOf(node, 'consequence'))[0])
    : undefined;

const modifierIf = (node: Node): Read | undefined =>
  guardOf(node, node.type.replace('_modifier', ''), fieldOf(node, 'body'));

const READS = new Map<string, (node: Node) => Read | undefined>([
  ['if', blockIf],
  ['unless', blockIf],
  ['if_modifier', modifierIf],
  ['unless_modifier', modifierIf],
]);

type Walk = { readonly depth: number };

const decisionsUnder = (walk: Walk, nodes: ReadonlyArray<Node>): ReadonlyArray<Decision> =>
  nodes.flatMap(node => {
    const read = READS.get(node.type)?.(node);
    if (read === undefined) return decisionsUnder(walk, node.namedChildren);
    return [
      {
        kind: read.kind,
        text: read.text,
        depth: walk.depth,
        line: node.startPosition.row + 1,
      },
      ...decisionsUnder({ depth: walk.depth + 1 }, read.deeper),
    ];
  });

export const decisionsOfMethod = (method: Node): ReadonlyArray<Decision> =>
  decisionsUnder({ depth: 0 }, method.namedChildren);
