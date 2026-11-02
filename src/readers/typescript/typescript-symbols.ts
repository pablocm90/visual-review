import type { ClassDeclaration, Function as FunctionNode, Node } from '@babel/types';
import type { FileSymbols } from '../../core/reader.ts';
import {
  nameOf,
  parseTypeScript,
  sourceOf,
  symbolsIn,
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
]);

const isFunctionNode = (node: Node): node is FunctionNode => FUNCTIONS.has(node.type);

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

export const symbolsOfTypeScript = (text: string, path: string): FileSymbols => {
  const { program } = parseTypeScript(text, path);
  const names = new Set(program.body.flatMap(statement => exportedBy(text, statement)));
  return {
    symbols: symbolsIn(text, program).map(walked => ({
      ...walked.symbol,
      exported: isExported(names, walked),
      signature: signatureOf(text, walked.node),
    })),
  };
};
