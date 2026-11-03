import { createHash } from 'node:crypto';
import type {
  ClassDeclaration,
  Function as FunctionNode,
  Node,
  TSDeclareFunction,
  TSDeclareMethod,
} from '@babel/types';
import type { FileSymbols } from '../../core/reader.ts';
import { decisionsIn } from './typescript-decisions.ts';
import {
  isOverload,
  isTooBig,
  nameOf,
  parseTypeScript,
  sourceOf,
  symbolsIn,
  TOO_BIG,
  type WalkedSymbol,
} from './typescript-syntax.ts';

const declaredNames = (text: string, node: Node): ReadonlyArray<string> => {
  if (node.type === 'VariableDeclaration')
    return node.declarations.map(({ id }) => nameOf(text, id));
  return 'id' in node && node.id ? [nameOf(text, node.id)] : [];
};

const defaultExported = (text: string, declaration: Node): ReadonlyArray<string> => {
  if (declaration.type === 'Identifier') return [declaration.name];
  const named = declaredNames(text, declaration);
  return named.length === 0 ? ['default'] : named;
};

const exportedBy = (text: string, statement: Node): ReadonlyArray<string> => {
  if (statement.type === 'ExportDefaultDeclaration')
    return defaultExported(text, statement.declaration);
  if (statement.type !== 'ExportNamedDeclaration' || statement.source) return [];
  return statement.declaration
    ? declaredNames(text, statement.declaration)
    : statement.specifiers.flatMap(specifier =>
        specifier.type === 'ExportSpecifier' ? [nameOf(text, specifier.local)] : [],
      );
};

const namesExportedBy = (text: string, statement: Node): ReadonlyArray<string> => {
  if (statement.type === 'ExportDefaultDeclaration') return ['default'];
  if (statement.type === 'ExportAllDeclaration') return [`* from ${statement.source.value}`];
  if (statement.type !== 'ExportNamedDeclaration') return [];
  return statement.declaration
    ? declaredNames(text, statement.declaration)
    : statement.specifiers.map(({ exported }) => nameOf(text, exported));
};

const isPrivate = (declaration: Node): boolean =>
  declaration.type === 'ClassPrivateMethod' ||
  declaration.type === 'ClassPrivateProperty' ||
  ('accessibility' in declaration && declaration.accessibility === 'private');

const isExported = (names: ReadonlySet<string>, { symbol, declaration }: WalkedSymbol) =>
  symbol.scope === undefined
    ? names.has(symbol.name)
    : symbol.kind === 'method' && names.has(symbol.scope) && !isPrivate(declaration);

const collapsed = (text: string, node: Node | null | undefined): string =>
  node ? sourceOf(text, node).replace(/\s+/g, ' ') : '';

const FUNCTIONS = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'ClassMethod',
  'ClassPrivateMethod',
  'ObjectMethod',
  'TSDeclareFunction',
  'TSDeclareMethod',
]);

const isFunctionNode = (node: Node): node is FunctionNode | TSDeclareFunction | TSDeclareMethod =>
  FUNCTIONS.has(node.type);

const keyOf = ({ symbol }: WalkedSymbol): string => `${symbol.scope}.${symbol.name}`;

const overloadsBefore = (
  walk: ReadonlyArray<WalkedSymbol>,
  index: number,
  key: string,
): ReadonlyArray<Node> => {
  const previous = walk[index - 1];
  return previous && isOverload(previous.node) && keyOf(previous) === key
    ? [...overloadsBefore(walk, index - 1, key), previous.node]
    : [];
};

const withHeads = (walked: WalkedSymbol, index: number, walk: ReadonlyArray<WalkedSymbol>) => {
  if (isOverload(walked.node)) return [];
  const overloads = overloadsBefore(walk, index, keyOf(walked));
  return [{ ...walked, heads: overloads.length > 0 ? overloads : [walked.node] }];
};

const heritageOf = (text: string, node: ClassDeclaration): string =>
  [
    node.abstract ? 'abstract' : '',
    collapsed(text, node.typeParameters),
    node.superClass
      ? `extends ${collapsed(text, node.superClass)}${collapsed(text, node.superTypeArguments)}`
      : '',
    node.implements
      ? `implements ${node.implements.map(type => collapsed(text, type)).join(', ')}`
      : '',
  ]
    .filter(part => part !== '')
    .join(' ');

const signatureOf = (text: string, node: Node): string => {
  if (node.type === 'ClassDeclaration') return heritageOf(text, node);
  if (!isFunctionNode(node)) return collapsed(text, node);
  const prefix = `${node.async ? 'async ' : ''}${node.generator ? '*' : ''}`;
  const params = node.params.map(param => collapsed(text, param)).join(', ');
  return `${prefix}${collapsed(text, node.typeParameters)}(${params})${collapsed(text, node.returnType)}`;
};

const UNHASHED = new Set([
  'start',
  'end',
  'extra',
  'leadingComments',
  'trailingComments',
  'innerComments',
]);

type Replacer = (holder: unknown, key: string, value: unknown) => unknown;

const asIs: Replacer = (_holder, _key, value) => value;

const sha1 = (text: string): string => createHash('sha1').update(text).digest('hex');

const hashOf = (value: unknown, replace: Replacer): string =>
  sha1(
    JSON.stringify(value, function (this: unknown, key: string, inner: unknown) {
      return UNHASHED.has(key) ? undefined : replace(this, key, inner);
    }),
  );

const bodyHashOf = (node: Node, nested: ReadonlySet<unknown>): string =>
  hashOf(node, (holder, key, value) => {
    if (holder === node && (key === 'id' || key === 'key')) return undefined;
    return value !== node && nested.has(value) ? 'symbol' : value;
  });

const signatureNodesOf = (node: Node): unknown => {
  if (node.type === 'ClassDeclaration')
    return [
      node.abstract,
      node.typeParameters,
      node.superClass,
      node.superTypeArguments,
      node.implements,
    ];
  if (!isFunctionNode(node)) return node;
  return [node.async, node.generator, node.typeParameters, node.params, node.returnType];
};

type Range = { readonly start?: number | null; readonly end?: number | null };

const startOf = (range: Range): number => range.start ?? 0;
const endOf = (range: Range): number => range.end ?? 0;

const within = (outer: Range, inner: Range): boolean =>
  startOf(inner) >= startOf(outer) && endOf(inner) <= endOf(outer);

const holesIn = (node: Node, holes: ReadonlyArray<Node>): ReadonlyArray<Node> =>
  holes.filter(hole => hole !== node && within(node, hole));

type Cut = { readonly pieces: ReadonlyArray<string>; readonly cursor: number };

const ownText = (text: string, node: Node, holes: ReadonlyArray<Node>): string => {
  const { pieces, cursor } = holesIn(node, holes).reduce<Cut>(
    (cut, hole) => ({
      pieces: [...cut.pieces, text.slice(cut.cursor, startOf(hole))],
      cursor: Math.max(cut.cursor, endOf(hole)),
    }),
    { pieces: [], cursor: startOf(node) },
  );
  return [...pieces, text.slice(cursor, endOf(node))].join('');
};

type Token = Range & { readonly type: unknown };

const isToken = (value: unknown): value is Token =>
  typeof value === 'object' && value !== null && 'type' in value;

const isCode = (token: Token): boolean =>
  endOf(token) > startOf(token) && token.type !== 'CommentLine' && token.type !== 'CommentBlock';

const nameOfNode = (node: Node): ReadonlyArray<Node> => {
  if ('id' in node && node.id) return [node.id];
  return 'key' in node ? [node.key] : [];
};

const tokensOf = (
  text: string,
  node: Node,
  tokens: ReadonlyArray<Token>,
  holes: ReadonlyArray<Node>,
): ReadonlyArray<string> => {
  const skipped = [...holesIn(node, holes), ...nameOfNode(node)];
  return tokens
    .filter(token => within(node, token) && !skipped.some(hole => within(hole, token)))
    .map(token => text.slice(startOf(token), endOf(token)));
};

export const symbolsOfTypeScript = (text: string, path: string): FileSymbols => {
  if (isTooBig(text)) throw new Error(TOO_BIG);
  const { program, tokens } = parseTypeScript(text, path);
  const code = (tokens ?? []).filter(isToken).filter(isCode);
  const names = new Set(program.body.flatMap(statement => exportedBy(text, statement)));
  const walk = symbolsIn(text, program).flatMap(withHeads);
  const declarations = walk.map(({ declaration }) => declaration);
  const nested = new Set<unknown>(declarations);
  return {
    symbols: walk.map(walked => ({
      ...walked.symbol,
      exported: isExported(names, walked),
      signature: walked.heads.map(head => signatureOf(text, head)).join('; '),
      signatureHash: hashOf(walked.heads.map(signatureNodesOf), asIs),
      bodyHash: bodyHashOf(walked.node, nested),
      textHash: sha1(
        [...walked.heads, walked.node].map(node => ownText(text, node, declarations)).join(''),
      ),
      bodyTokens: tokensOf(text, walked.node, code, declarations),
      decisions: decisionsIn({ text, node: walked.node, nested }),
    })),
    astHash: hashOf(program, asIs),
    exports: program.body.flatMap(statement => namesExportedBy(text, statement)),
  };
};
