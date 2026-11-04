import { type ParserPlugin, parse } from '@babel/parser';
import type { Node } from '@babel/types';
import type { ReadSymbol, SymbolKind } from '../../core/reader.ts';

const TYPESCRIPT: Array<ParserPlugin> = [
  'typescript',
  'decorators-legacy',
  'decoratorAutoAccessors',
];

const pluginsFor = (path: string): Array<ParserPlugin> => {
  if (path.endsWith('.tsx')) return [...TYPESCRIPT, 'jsx'];
  return /\.[cm]?ts$/.test(path) ? TYPESCRIPT : ['jsx'];
};

const isNode = (value: unknown): value is Node =>
  typeof value === 'object' && value !== null && 'type' in value;

export const childrenOf = (node: Node): ReadonlyArray<Node> =>
  Object.values(node)
    .flatMap((value: unknown) => (Array.isArray(value) ? value : [value]))
    .filter(isNode);

type OwnFunction = { readonly name: string; readonly fn: Node };

export type WalkedSymbol = {
  readonly symbol: Pick<ReadSymbol, 'name' | 'scope' | 'kind'>;
  readonly node: Node;
  readonly declaration: Node;
};

export const sourceOf = (text: string, node: Node): string =>
  text.slice(node.start ?? undefined, node.end ?? undefined);

export const nameOf = (text: string, node: Node): string =>
  node.type === 'Identifier' ? node.name : sourceOf(text, node);

const unwrapped = (node: Node): Node =>
  node.type === 'TSAsExpression' ||
  node.type === 'TSSatisfiesExpression' ||
  node.type === 'TSNonNullExpression' ||
  node.type === 'TSTypeAssertion'
    ? unwrapped(node.expression)
    : node;

const functionValue = (value: Node | null | undefined): Node | undefined => {
  const node = value ? unwrapped(value) : undefined;
  return node?.type === 'ArrowFunctionExpression' || node?.type === 'FunctionExpression'
    ? node
    : undefined;
};

const assigned = (text: string, name: Node, value: Node | null | undefined) => {
  const fn = functionValue(value);
  return fn === undefined ? undefined : { name: nameOf(text, name), fn };
};

const declaredFunction = (text: string, node: Node): OwnFunction | undefined => {
  switch (node.type) {
    case 'FunctionDeclaration':
    case 'TSDeclareFunction':
      return { name: node.id ? sourceOf(text, node.id) : 'default', fn: node };
    default:
      return undefined;
  }
};

const declaredMethod = (text: string, node: Node): OwnFunction | undefined => {
  switch (node.type) {
    case 'ClassMethod':
    case 'ClassPrivateMethod':
    case 'ObjectMethod':
    case 'TSDeclareMethod':
      return { name: sourceOf(text, node.key), fn: node };
    default:
      return undefined;
  }
};

const assignedFunction = (text: string, node: Node): OwnFunction | undefined => {
  switch (node.type) {
    case 'VariableDeclarator':
      return assigned(text, node.id, node.init);
    case 'AssignmentExpression':
      return assigned(text, node.left, node.right);
    case 'ClassProperty':
    case 'ClassPrivateProperty':
    case 'ObjectProperty':
      return assigned(text, node.key, node.value);
    default:
      return undefined;
  }
};

const ownFunction = (text: string, node: Node): OwnFunction | undefined =>
  declaredFunction(text, node) ?? declaredMethod(text, node) ?? assignedFunction(text, node);

const holderOf = (text: string, node: Node): string | undefined => {
  if (node.type === 'VariableDeclarator') return nameOf(text, node.id);
  if (node.type === 'AssignmentExpression') return sourceOf(text, node.left);
  return node.type === 'ExportDefaultDeclaration' ? 'default' : undefined;
};

type Scope = {
  readonly inFunction: boolean;
  readonly holder: string | undefined;
  readonly scope: string | undefined;
};

const heldFunction = (node: Node, holder: string | undefined): OwnFunction | undefined =>
  holder === undefined || functionValue(node) === undefined
    ? undefined
    : { name: holder, fn: node };

const METHODS = new Set([
  'ClassMethod',
  'ClassPrivateMethod',
  'ClassProperty',
  'ClassPrivateProperty',
  'ObjectMethod',
  'ObjectProperty',
]);

const ACCESSORS: ReadonlyMap<unknown, SymbolKind> = new Map([
  ['get', 'getter'],
  ['set', 'setter'],
]);

const kindOf = (node: Node): SymbolKind =>
  ('kind' in node && ACCESSORS.get(node.kind)) || (METHODS.has(node.type) ? 'method' : 'function');

const qualified = (scope: string | undefined, name: string): string =>
  scope === undefined ? name : `${scope}.${name}`;

type OwnSymbol = { readonly name: string; readonly kind: SymbolKind; readonly node: Node };

const TYPES = new Set(['TSTypeAliasDeclaration', 'TSInterfaceDeclaration', 'TSEnumDeclaration']);

const declaredSymbol = (text: string, node: Node): OwnSymbol | undefined => {
  if (node.type === 'ClassDeclaration')
    return { name: node.id ? sourceOf(text, node.id) : 'default', kind: 'class', node };
  return TYPES.has(node.type) && 'id' in node && node.id
    ? { name: sourceOf(text, node.id), kind: 'type', node }
    : undefined;
};

const ownSymbol = (text: string, node: Node, holder: string | undefined) => {
  const own = ownFunction(text, node) ?? heldFunction(node, holder);
  return own === undefined
    ? declaredSymbol(text, node)
    : { name: own.name, kind: kindOf(node), node: own.fn };
};

const objectNameOf = (text: string, node: Node): string | undefined =>
  node.type === 'VariableDeclarator' &&
  node.init &&
  unwrapped(node.init).type === 'ObjectExpression'
    ? nameOf(text, node.id)
    : undefined;

export const isOverload = (node: Node): boolean =>
  node.type === 'TSDeclareFunction' || node.type === 'TSDeclareMethod';

export const isMethod = ({ kind }: { readonly kind: SymbolKind }): boolean =>
  kind === 'method' || kind === 'getter' || kind === 'setter';

export const isFunction = (symbol: { readonly kind: SymbolKind }): boolean =>
  symbol.kind === 'function' || isMethod(symbol);

const symbolOf = (
  { name, kind, node }: OwnSymbol,
  scope: string | undefined,
  declaration: Node,
): WalkedSymbol => ({
  symbol: { name, kind, ...(scope === undefined ? {} : { scope }) },
  node,
  declaration,
});

type Within = {
  readonly text: string;
  readonly node: Node;
  readonly own: OwnSymbol | undefined;
  readonly scope: Scope;
};

const placeWithin = ({ text, node, own, scope }: Within): string | undefined => {
  const name = own?.name ?? objectNameOf(text, node);
  return name === undefined ? scope.scope : qualified(scope.scope, name);
};

const scopeWithin = (within: Within): Scope => {
  const { text, node, own, scope } = within;
  const place = placeWithin(within);
  return (own !== undefined && isFunction(own)) || scope.inFunction
    ? { inFunction: true, holder: undefined, scope: place }
    : { inFunction: false, holder: holderOf(text, node) ?? scope.holder, scope: place };
};

const symbolsUnder = (text: string, node: Node, scope: Scope): ReadonlyArray<WalkedSymbol> => {
  const own = ownSymbol(text, node, scope.holder);
  const within = scopeWithin({ text, node, own, scope });
  const inner = childrenOf(node).flatMap(child => symbolsUnder(text, child, within));
  return own === undefined ? inner : [symbolOf(own, scope.scope, node), ...inner];
};

export const symbolsIn = (text: string, program: Node): ReadonlyArray<WalkedSymbol> =>
  symbolsUnder(text, program, { inFunction: false, holder: undefined, scope: undefined });

const MOST_CHARACTERS = 262_144;

const LONGEST_LINE = 1000;

const grouped = (count: number): string => count.toLocaleString('en');

export const TOO_BIG = `too big to read: over ${grouped(MOST_CHARACTERS)} characters or a line over ${grouped(LONGEST_LINE)}`;

export const isTooBig = (text: string): boolean =>
  text.length > MOST_CHARACTERS || text.split('\n').some(line => line.length > LONGEST_LINE);

export const parseTypeScript = (text: string, path: string) =>
  parse(text, { sourceType: 'module', plugins: pluginsFor(path), tokens: true });
