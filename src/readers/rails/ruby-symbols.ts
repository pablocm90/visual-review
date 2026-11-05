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
  readonly singleton: boolean;
  readonly moduleFunction: boolean;
  readonly symbols: ReadonlyArray<ReadSymbol>;
};

const STARTING: Walk = { exported: true, singleton: false, moduleFunction: false, symbols: [] };

const methodSymbol = (method: Node, within: string | undefined, walk: Walk): ReadSymbol => {
  const name = method.childForFieldName('name');
  const isSetter = name?.type === 'setter';
  const written = (isSetter ? name.text.slice(0, -1) : name?.text) ?? '';
  const object =
    method.childForFieldName('object')?.text ??
    (walk.singleton || walk.moduleFunction ? 'self' : undefined);
  return {
    name: object === undefined ? written : `${object}.${written}`,
    ...(within === undefined ? {} : { scope: within }),
    kind: isSetter ? 'setter' : within === undefined ? 'function' : 'method',
    exported: method.type === 'singleton_method' || walk.exported || written === 'initialize',
    signature: '',
    ...NOT_YET_HASHED,
  };
};

const BARE_WORDS = new Map([
  ['private', { exported: false, moduleFunction: false }],
  ['protected', { exported: false, moduleFunction: false }],
  ['public', { exported: true, moduleFunction: false }],
  ['module_function', { exported: true, moduleFunction: true }],
]);

const METHODS = new Set(['method', 'singleton_method']);

const isSingletonBlock = (node: Node): boolean =>
  node.type === 'singleton_class' ||
  (node.type === 'call' && node.childForFieldName('method')?.text === 'class_methods');

const walked = (walk: Walk, node: Node, within: string | undefined): Walk => {
  const joined = (inner: Walk): Walk => ({ ...walk, symbols: [...walk.symbols, ...inner.symbols] });
  if (node.type === 'identifier' && BODIES.has(node.parent?.type ?? ''))
    return { ...walk, ...BARE_WORDS.get(node.text) };
  if (METHODS.has(node.type))
    return { ...walk, symbols: [...walk.symbols, methodSymbol(node, within, walk)] };
  if (BODIES.has(node.type))
    return joined(walkedChildren({ ...STARTING, singleton: walk.singleton }, node, within));
  if (isSingletonBlock(node))
    return joined(walkedChildren({ ...STARTING, singleton: true }, node, within));
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
