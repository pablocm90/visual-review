import type { Node } from 'web-tree-sitter';
import type { FileSymbols, ReadSymbol } from '../../core/reader.ts';
import { isTooBig, TOO_BIG } from '../too-big.ts';
import { parseRuby } from './ruby-syntax.ts';

const DEFINITIONS = new Set(['class', 'module']);

const BODIES = new Set(['program', 'body_statement', 'block_body']);

const constantWithin = (written: string, within: string | undefined): string => {
  if (written.startsWith('::')) return written.slice(2);
  return within === undefined ? written : `${within}::${written}`;
};

const signatureOf = (definition: Node): string =>
  definition.childForFieldName('superclass')?.text ?? '';

const NOT_YET_HASHED = { signatureHash: '', bodyHash: '', textHash: '', bodyTokens: [] };

type ByName = {
  readonly key: string;
  readonly exported: boolean;
  readonly toSingleton: boolean;
};

type Walk = {
  readonly exported: boolean;
  readonly singleton: boolean;
  readonly moduleFunction: boolean;
  readonly hiddenClassMethod: boolean;
  readonly byName: ReadonlyArray<ByName>;
  readonly privateConstants: ReadonlyArray<string>;
  readonly symbols: ReadonlyArray<ReadSymbol>;
};

const STARTING: Walk = {
  exported: true,
  singleton: false,
  moduleFunction: false,
  hiddenClassMethod: false,
  byName: [],
  privateConstants: [],
  symbols: [],
};

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
    exported:
      method.type === 'singleton_method'
        ? !walk.hiddenClassMethod
        : walk.exported || written === 'initialize',
    signature: '',
    ...NOT_YET_HASHED,
  };
};

const symbolsNamedIn = (call: Node): ReadonlyArray<string> =>
  (call.childForFieldName('arguments')?.namedChildren ?? [])
    .filter(({ type }) => type === 'simple_symbol')
    .map(({ text }) => text.slice(1));

const ATTRS = new Map<string, ReadonlyArray<'getter' | 'setter'>>([
  ['attr_reader', ['getter']],
  ['attr_writer', ['setter']],
  ['attr_accessor', ['getter', 'setter']],
]);

const attrSymbols = (
  call: Node,
  kinds: ReadonlyArray<'getter' | 'setter'>,
  within: string | undefined,
  walk: Walk,
): ReadonlyArray<ReadSymbol> =>
  symbolsNamedIn(call).flatMap(name =>
    kinds.map(kind => ({
      name: walk.singleton || walk.moduleFunction ? `self.${name}` : name,
      ...(within === undefined ? {} : { scope: within }),
      kind,
      exported: walk.exported,
      signature: '',
      ...NOT_YET_HASHED,
    })),
  );

const BARE_WORDS = new Map([
  ['private', { exported: false, moduleFunction: false }],
  ['protected', { exported: false, moduleFunction: false }],
  ['public', { exported: true, moduleFunction: false }],
  ['module_function', { exported: true, moduleFunction: true }],
]);

const VISIBILITY_CALLS = new Map<string, Partial<Walk> & Pick<Walk, 'exported'>>([
  ...BARE_WORDS,
  ['private_class_method', { exported: false, hiddenClassMethod: true }],
]);

const namedIn = (
  call: Node,
  held: Partial<Walk> & Pick<Walk, 'exported'>,
  walk: Walk,
): ReadonlyArray<ByName> =>
  symbolsNamedIn(call).map(name => ({
    key: `${walk.singleton || held.hiddenClassMethod ? 'self.' : ''}${name}`,
    exported: held.exported,
    toSingleton: held.moduleFunction === true,
  }));

const keyOf = ({ kind, name }: ReadSymbol): string => (kind === 'setter' ? `${name}=` : name);

const isOrIsBelow = (name: string, constant: string): boolean =>
  name === constant || name.startsWith(`${constant}::`);

const withoutPrivateConstants = (
  inner: Walk,
  within: string | undefined,
): ReadonlyArray<ReadSymbol> => {
  const hidden = inner.privateConstants.map(name => constantWithin(name, within));
  return inner.symbols.map(symbol =>
    hidden.some(constant => isOrIsBelow(symbol.scope ?? symbol.name, constant))
      ? { ...symbol, exported: false }
      : symbol,
  );
};

const settledByName = (inner: Walk, within: string | undefined): ReadonlyArray<ReadSymbol> => {
  const last = new Map(inner.byName.map(named => [named.key, named]));
  return inner.symbols.map(symbol => {
    const named = symbol.scope === within ? last.get(keyOf(symbol)) : undefined;
    if (named === undefined) return symbol;
    return {
      ...symbol,
      exported: named.exported,
      name: named.toSingleton ? `self.${symbol.name}` : symbol.name,
    };
  });
};

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
  if (BODIES.has(node.type)) {
    const inner = walkedChildren({ ...STARTING, singleton: walk.singleton }, node, within);
    return joined({
      ...inner,
      symbols: withoutPrivateConstants({ ...inner, symbols: settledByName(inner, within) }, within),
    });
  }
  if (isSingletonBlock(node))
    return joined(walkedChildren({ ...STARTING, singleton: true }, node, within));
  const called = node.childForFieldName('method')?.text;
  if (called === 'private_constant')
    return { ...walk, privateConstants: [...walk.privateConstants, ...symbolsNamedIn(node)] };
  const attrs = ATTRS.get(called ?? '');
  if (attrs)
    return { ...walk, symbols: [...walk.symbols, ...attrSymbols(node, attrs, within, walk)] };
  const held = VISIBILITY_CALLS.get(called ?? '');
  if (held)
    return {
      ...walk,
      byName: [...walk.byName, ...namedIn(node, held, walk)],
      symbols: walkedChildren({ ...walk, ...held }, node, within).symbols,
    };
  if (!DEFINITIONS.has(node.type)) return walkedChildren(walk, node, within);
  const constant = constantWithin(node.childForFieldName('name')?.text ?? '', within);
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
