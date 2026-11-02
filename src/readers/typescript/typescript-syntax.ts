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

export type WalkedSymbol = { readonly symbol: ReadSymbol; readonly node: Node };

const sourceOf = (text: string, node: Node): string =>
  text.slice(node.start ?? undefined, node.end ?? undefined);

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
  return fn === undefined ? undefined : { name: sourceOf(text, name), fn };
};

const ownFunction = (text: string, node: Node): OwnFunction | undefined => {
  switch (node.type) {
    case 'FunctionDeclaration':
      return { name: node.id ? sourceOf(text, node.id) : 'default', fn: node };
    case 'ClassMethod':
    case 'ClassPrivateMethod':
    case 'ObjectMethod':
      return { name: sourceOf(text, node.key), fn: node };
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

const holderOf = (text: string, node: Node): string | undefined => {
  if (node.type === 'VariableDeclarator') return sourceOf(text, node.id);
  if (node.type === 'AssignmentExpression') return sourceOf(text, node.left);
  return node.type === 'ExportDefaultDeclaration' ? 'default' : undefined;
};

type Scope = { readonly inFunction: boolean; readonly holder: string | undefined };

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

const kindOf = (node: Node): SymbolKind => (METHODS.has(node.type) ? 'method' : 'function');

const symbolOf = (node: Node, own: OwnFunction): WalkedSymbol => ({
  symbol: { name: own.name, kind: kindOf(node) },
  node: own.fn,
});

const functionsUnder = (text: string, node: Node, scope: Scope): ReadonlyArray<WalkedSymbol> => {
  const own = ownFunction(text, node) ?? heldFunction(node, scope.holder);
  const inner = childrenOf(node).flatMap(child =>
    functionsUnder(
      text,
      child,
      own !== undefined || scope.inFunction
        ? { inFunction: true, holder: undefined }
        : { inFunction: false, holder: holderOf(text, node) ?? scope.holder },
    ),
  );
  return own === undefined ? inner : [symbolOf(node, own), ...inner];
};

export const functionsIn = (text: string, program: Node): ReadonlyArray<WalkedSymbol> =>
  functionsUnder(text, program, { inFunction: false, holder: undefined });

export const parseTypeScript = (text: string, path: string) =>
  parse(text, { sourceType: 'module', plugins: pluginsFor(path), tokens: true });
