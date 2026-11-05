import { createHash } from 'node:crypto';
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

type Shape = string | ReadonlyArray<Shape>;

type Holes = ReadonlySet<number>;

const NO_HOLES: Holes = new Set();

const shapeOf = (node: Node, holes: Holes = NO_HOLES): Shape => {
  if (holes.has(node.id)) return [];
  return node.childCount === 0
    ? node.text
    : node.children.filter(({ type }) => type !== 'comment').map(child => shapeOf(child, holes));
};

const hashOf = (shape: Shape): string =>
  createHash('sha1').update(JSON.stringify(shape)).digest('hex');

const shapesOf = (nodes: ReadonlyArray<Node>, holes: Holes = NO_HOLES): Shape =>
  nodes.map(node => shapeOf(node, holes));

const holesIn = (node: Node, holes: Holes): ReadonlyArray<Node> =>
  holes.has(node.id) ? [node] : node.children.flatMap(child => holesIn(child, holes));

const ownText = (definition: Node, holes: Holes): string => {
  const start = definition.startIndex;
  const whole = definition.text;
  const { kept, from } = holesIn(definition, holes).reduce(
    (cut, hole) => ({
      kept: cut.kept + whole.slice(cut.from, hole.startIndex - start),
      from: hole.endIndex - start,
    }),
    { kept: '', from: 0 },
  );
  return kept + whole.slice(from);
};

const tokensOf = (shape: Shape): ReadonlyArray<string> =>
  typeof shape === 'string' ? [shape] : shape.flatMap(tokensOf);

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
  readonly holes: ReadonlyArray<number>;
};

const STARTING: Walk = {
  exported: true,
  singleton: false,
  moduleFunction: false,
  hiddenClassMethod: false,
  byName: [],
  privateConstants: [],
  symbols: [],
  holes: [],
};

const parametersOf = (method: Node): ReadonlyArray<Node> =>
  (method.childForFieldName('parameters')?.namedChildren ?? []).filter(
    ({ type }) => type !== 'comment',
  );

const parameterText = (method: Node): string => {
  const written = parametersOf(method).map(({ text }) => text.replace(/\s+/g, ' '));
  return written.length === 0 ? '' : `(${written.join(', ')})`;
};

const fieldOf = (definition: Node, field: string): ReadonlyArray<Node> => {
  const child = definition.childForFieldName(field);
  return child === null ? [] : [child];
};

type Hashed = {
  readonly signed: ReadonlyArray<Node>;
  readonly body: ReadonlyArray<Node>;
  readonly holes?: Holes;
  readonly text: string;
};

const hashesOf = ({ signed, body, holes, text }: Hashed) => {
  const shapes = [shapesOf(signed), shapesOf(body, holes)];
  return {
    signatureHash: hashOf(shapesOf(signed)),
    bodyHash: hashOf(shapes),
    textHash: hashOf(text),
    bodyTokens: tokensOf(shapes),
  };
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
    signature: parameterText(method),
    ...hashesOf({ signed: parametersOf(method), body: fieldOf(method, 'body'), text: method.text }),
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

const memberOf = (
  name: string,
  rest: Pick<ReadSymbol, 'kind' | 'exported' | 'signature'>,
  within: string | undefined,
  walk: Walk,
): ReadSymbol => ({
  name: walk.singleton || walk.moduleFunction ? `self.${name}` : name,
  ...(within === undefined ? {} : { scope: within }),
  ...rest,
  ...NOT_YET_HASHED,
});

const attrSymbols = (
  call: Node,
  kinds: ReadonlyArray<'getter' | 'setter'>,
  within: string | undefined,
  walk: Walk,
): ReadonlyArray<ReadSymbol> =>
  symbolsNamedIn(call).flatMap(name =>
    kinds.map(kind =>
      memberOf(name, { kind, exported: walk.exported, signature: '' }, within, walk),
    ),
  );

const optionOf = (call: Node, option: string): Node | undefined =>
  call
    .childForFieldName('arguments')
    ?.namedChildren.find(child =>
      [option, `:${option}`].includes(child.childForFieldName('key')?.text ?? ''),
    )
    ?.childForFieldName('value') ?? undefined;

const writtenName = (value: Node | undefined): string => {
  if (value?.type === 'simple_symbol') return value.text.slice(1);
  return value?.namedChildren[0]?.text ?? '';
};

const delegatePrefix = (call: Node): string => {
  const prefix = optionOf(call, 'prefix');
  if (prefix === undefined || prefix.type === 'false') return '';
  return `${writtenName(prefix.type === 'true' ? optionOf(call, 'to') : prefix)}_`;
};

const delegateSymbols = (
  call: Node,
  within: string | undefined,
  walk: Walk,
): ReadonlyArray<ReadSymbol> =>
  symbolsNamedIn(call).map(name =>
    memberOf(
      `${delegatePrefix(call)}${name}`,
      {
        kind: 'method',
        exported: walk.exported && optionOf(call, 'private')?.type !== 'true',
        signature: `to: ${optionOf(call, 'to')?.text ?? ''}`,
      },
      within,
      walk,
    ),
  );

const scopeSymbols = (call: Node, within: string | undefined): ReadonlyArray<ReadSymbol> => {
  const [named, callable] = call.childForFieldName('arguments')?.namedChildren ?? [];
  if (callable === undefined || callable.type === 'pair') return [];
  return [
    memberOf(writtenName(named), { kind: 'method', exported: true, signature: '' }, within, {
      ...STARTING,
      singleton: true,
    }),
  ];
};

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
  const joined = (inner: Walk): Walk => ({
    ...walk,
    symbols: [...walk.symbols, ...inner.symbols],
    holes: [...walk.holes, ...inner.holes],
  });
  if (node.type === 'identifier' && BODIES.has(node.parent?.type ?? ''))
    return { ...walk, ...BARE_WORDS.get(node.text) };
  if (METHODS.has(node.type))
    return {
      ...walk,
      symbols: [...walk.symbols, methodSymbol(node, within, walk)],
      holes: [...walk.holes, node.id],
    };
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
  if (called === 'scope')
    return { ...walk, symbols: [...walk.symbols, ...scopeSymbols(node, within)] };
  if (called === 'delegate')
    return { ...walk, symbols: [...walk.symbols, ...delegateSymbols(node, within, walk)] };
  const held = VISIBILITY_CALLS.get(called ?? '');
  if (held) {
    const inner = walkedChildren({ ...walk, ...held }, node, within);
    return {
      ...walk,
      byName: [...walk.byName, ...namedIn(node, held, walk)],
      symbols: inner.symbols,
      holes: inner.holes,
    };
  }
  if (!DEFINITIONS.has(node.type)) return walkedChildren(walk, node, within);
  const constant = constantWithin(node.childForFieldName('name')?.text ?? '', within);
  const inner = walkedChildren(STARTING, node, constant);
  const holes = new Set(inner.holes);
  const definition: ReadSymbol = {
    name: constant,
    kind: 'class',
    exported: true,
    signature: signatureOf(node),
    ...hashesOf({
      signed: fieldOf(node, 'superclass'),
      body: fieldOf(node, 'body'),
      holes,
      text: ownText(node, holes),
    }),
  };
  return {
    ...walk,
    symbols: [...walk.symbols, definition, ...inner.symbols],
    holes: [...walk.holes, node.id],
  };
};

const walkedChildren = (walk: Walk, node: Node, within: string | undefined): Walk =>
  node.namedChildren.reduce<Walk>((sofar, child) => walked(sofar, child, within), walk);

export const symbolsOfRuby = (text: string): FileSymbols => {
  if (isTooBig(text)) throw new Error(TOO_BIG);
  const program = parseRuby(text);
  if (program === undefined || program.hasError) throw new Error('Ruby that does not parse');
  return {
    symbols: walked(STARTING, program, undefined).symbols,
    exports: [],
    astHash: hashOf(shapeOf(program)),
  };
};
