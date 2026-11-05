import type { Node } from 'web-tree-sitter';
import type { FileSymbols, ReadSymbol } from '../../core/reader.ts';
import { isTooBig, TOO_BIG } from '../too-big.ts';
import { parseRuby } from './ruby-syntax.ts';

const DEFINITIONS = new Set(['class', 'module']);

const BODIES = new Set(['program', 'body_statement', 'block_body']);

const constantWithin = (definition: Node, within: string | undefined): string => {
  const written = definition.childForFieldName('name')?.text ?? '';
  if (written.startsWith('::')) return written.slice(2);
  return within === undefined ? written : `${within}::${written}`;
};

const signatureOf = (definition: Node): string =>
  definition.childForFieldName('superclass')?.text ?? '';

const NOT_YET_HASHED = { signatureHash: '', bodyHash: '', textHash: '', bodyTokens: [] };

type Walk = {
  readonly exported: boolean;
  readonly symbols: ReadonlyArray<ReadSymbol>;
};

const STARTING: Walk = { exported: true, symbols: [] };

const methodSymbol = (method: Node, within: string | undefined, walk: Walk): ReadSymbol => {
  const name = method.childForFieldName('name');
  const isSetter = name?.type === 'setter';
  return {
    name: (isSetter ? name.text.slice(0, -1) : name?.text) ?? '',
    ...(within === undefined ? {} : { scope: within }),
    kind: isSetter ? 'setter' : within === undefined ? 'function' : 'method',
    exported: walk.exported || name?.text === 'initialize',
    signature: '',
    ...NOT_YET_HASHED,
  };
};

const VISIBILITIES = new Map([
  ['private', false],
  ['protected', false],
  ['public', true],
]);

const walked = (walk: Walk, node: Node, within: string | undefined): Walk => {
  if (node.type === 'identifier' && BODIES.has(node.parent?.type ?? ''))
    return { ...walk, exported: VISIBILITIES.get(node.text) ?? walk.exported };
  if (node.type === 'method')
    return { ...walk, symbols: [...walk.symbols, methodSymbol(node, within, walk)] };
  if (BODIES.has(node.type))
    return {
      ...walk,
      symbols: [...walk.symbols, ...walkedChildren(STARTING, node, within).symbols],
    };
  if (!DEFINITIONS.has(node.type)) return walkedChildren(walk, node, within);
  const constant = constantWithin(node, within);
  const definition: ReadSymbol = {
    name: constant,
    kind: 'class',
    exported: true,
    signature: signatureOf(node),
    ...NOT_YET_HASHED,
  };
  return {
    ...walk,
    symbols: [...walk.symbols, definition, ...walkedChildren(STARTING, node, constant).symbols],
  };
};

const walkedChildren = (walk: Walk, node: Node, within: string | undefined): Walk =>
  node.namedChildren.reduce<Walk>((sofar, child) => walked(sofar, child, within), walk);

export const symbolsOfRuby = (text: string): FileSymbols => {
  if (isTooBig(text)) throw new Error(TOO_BIG);
  const program = parseRuby(text);
  if (program === undefined || program.hasError) throw new Error('Ruby that does not parse');
  return { symbols: walked(STARTING, program, undefined).symbols, exports: [], astHash: '' };
};
