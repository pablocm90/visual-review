import type { Node } from '@babel/types';
import type { FileSymbols } from '../../core/reader.ts';
import { nameOf, parseTypeScript, symbolsIn, type WalkedSymbol } from './typescript-syntax.ts';

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

const isExported = (names: ReadonlySet<string>, { symbol }: WalkedSymbol) =>
  symbol.scope === undefined
    ? names.has(symbol.name)
    : symbol.kind === 'method' && names.has(symbol.scope);

export const symbolsOfTypeScript = (text: string, path: string): FileSymbols => {
  const { program } = parseTypeScript(text, path);
  const names = new Set(program.body.flatMap(statement => exportedBy(text, statement)));
  return {
    symbols: symbolsIn(text, program).map(walked => ({
      ...walked.symbol,
      exported: isExported(names, walked),
    })),
  };
};
