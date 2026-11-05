import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { Language, type Node, Parser } from 'web-tree-sitter';

await Parser.init();

export const parserOf = async (grammar: string): Promise<(text: string) => Node | undefined> => {
  const parser = new Parser();
  parser.setLanguage(
    await Language.load(createRequire(import.meta.url).resolve(`${grammar}/${grammar}.wasm`)),
  );
  return text => parser.parse(text)?.rootNode;
};

export const codeLines = (root: Node, isSkipped: (node: Node) => boolean): number => {
  const rows = (node: Node): ReadonlyArray<number> => {
    if (isSkipped(node)) return [];
    if (node.childCount > 0) return node.children.flatMap(rows);
    const { startPosition, endPosition } = node;
    return Array.from(
      { length: endPosition.row - startPosition.row + 1 },
      (_, index) => startPosition.row + index,
    );
  };
  return new Set(root.children.flatMap(rows)).size;
};

type Shape = string | ReadonlyArray<Shape>;

export type Holes = ReadonlySet<number>;

const NO_HOLES: Holes = new Set();

export const isComment = ({ type }: Node): boolean => type.endsWith('comment');

const CLOSERS: ReadonlySet<string> = new Set([')', ']', '}', '>']);

const isOneTuple = ({ type, children }: Node): boolean =>
  type.startsWith('tuple') && children.filter(child => child.type === ',').length === 1;

const isTokens = ({ type }: Node): boolean => type.startsWith('token_');

const withoutLastComma = (children: ReadonlyArray<Node>): ReadonlyArray<Node> =>
  children.filter(({ type }, index) => {
    const next = children[index + 1];
    return type !== ',' || (next !== undefined && !CLOSERS.has(next.type));
  });

const writtenChildrenOf = (node: Node): ReadonlyArray<Node> => {
  const written = node.children.filter(child => !isComment(child));
  return isOneTuple(node) || isTokens(node) ? written : withoutLastComma(written);
};

export const shapeOf = (node: Node, holes: Holes = NO_HOLES): Shape => {
  if (holes.has(node.id)) return [];
  return node.childCount === 0
    ? node.text
    : writtenChildrenOf(node).map(child => shapeOf(child, holes));
};

export const hashOf = (shape: Shape): string =>
  createHash('sha1').update(JSON.stringify(shape)).digest('hex');

const shapesOf = (nodes: ReadonlyArray<Node>, holes: Holes = NO_HOLES): Shape =>
  nodes.map(node => shapeOf(node, holes));

const holesIn = (node: Node, holes: Holes): ReadonlyArray<Node> =>
  holes.has(node.id) ? [node] : node.children.flatMap(child => holesIn(child, holes));

export const ownText = (
  definition: Node,
  holes: Holes,
  readAs: (hole: Node) => string = () => '',
): string => {
  const start = definition.startIndex;
  const whole = definition.text;
  const { kept, from } = holesIn(definition, holes).reduce(
    (cut, hole) => ({
      kept: cut.kept + whole.slice(cut.from, hole.startIndex - start) + readAs(hole),
      from: hole.endIndex - start,
    }),
    { kept: '', from: 0 },
  );
  return kept + whole.slice(from);
};

const tokensOf = (shape: Shape): ReadonlyArray<string> =>
  typeof shape === 'string' ? [shape] : shape.flatMap(tokensOf);

type Leaf = Pick<Node, 'text' | 'startIndex' | 'endIndex'>;

type ElisionOf = (node: Node) => string | undefined;

const leavesOf = (node: Node, elisionOf: ElisionOf, end?: Node): ReadonlyArray<Leaf> => {
  if (isComment(node) || (end !== undefined && node.startIndex >= end.startIndex)) return [];
  const text = elisionOf(node);
  if (text !== undefined) return [{ text, startIndex: node.startIndex, endIndex: node.endIndex }];
  return node.childCount === 0
    ? [node]
    : node.children.flatMap(child => leavesOf(child, elisionOf, end));
};

const OPENERS: ReadonlySet<string> = new Set(['(', '[', '{']);
const BRACKET_CLOSERS: ReadonlySet<string> = new Set([')', ']', '}']);

export const codeReaderOf = (
  sends: ReadonlySet<string>,
  elisionOf: ElisionOf = () => undefined,
) => {
  const isGapped = (leaf: Leaf, before: Leaf | undefined): boolean =>
    before !== undefined &&
    leaf.startIndex > before.endIndex &&
    !OPENERS.has(before.text) &&
    !BRACKET_CLOSERS.has(leaf.text) &&
    !sends.has(leaf.text) &&
    !sends.has(before.text);

  const codeFrom = (leaves: ReadonlyArray<Leaf>): string => {
    const kept = leaves.filter(
      ({ text }, index) => !(text === ',' && BRACKET_CLOSERS.has(leaves[index + 1]?.text ?? '')),
    );
    return kept
      .map((leaf, index) => (isGapped(leaf, kept[index - 1]) ? ` ${leaf.text}` : leaf.text))
      .join('');
  };

  return {
    codeOf: (node: Node | undefined): string =>
      codeFrom(node === undefined ? [] : leavesOf(node, elisionOf)),
    codeUpTo: (node: Node, end: Node | undefined): string =>
      codeFrom(leavesOf(node, elisionOf, end)),
  };
};

type Hashed = {
  readonly signed: ReadonlyArray<Node>;
  readonly body: ReadonlyArray<Node>;
  readonly holes?: Holes;
  readonly text: string;
};

export const hashesOf = ({ signed, body, holes, text }: Hashed) => {
  const shapes = [shapesOf(signed), shapesOf(body, holes)];
  return {
    signatureHash: hashOf(shapesOf(signed)),
    bodyHash: hashOf(shapes),
    textHash: hashOf(text),
    bodyTokens: tokensOf(shapes),
  };
};
