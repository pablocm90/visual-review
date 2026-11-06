import { readFile } from 'node:fs/promises';
import { basename, dirname, join, posix } from 'node:path';
import type { ImportDeclaration } from '@babel/types';
import type { GraphNode } from '../../core/graph.ts';
import type { SymbolUse, UsesAsked, UsesReading } from '../../core/reader.ts';
import { endOf, isCode, isToken, startOf, type Token } from './typescript-symbols.ts';
import { parseTypeScript, sourceOf } from './typescript-syntax.ts';

const placeAt = (path: string, text: string, offset: number): SymbolUse => {
  const line = text.slice(0, offset).split('\n').length;
  return { path, line, text: (text.split('\n')[line - 1] ?? '').trim() };
};

const ACCESSES = new Set(['.', '?.']);

const moduleOf = (path: string): string => {
  const stem = path.replace(/\.[cm]?[jt]sx?$/, '');
  return basename(stem) === 'index' ? dirname(stem) : stem;
};

const namesFile = (specifier: string, importer: string, file: string): boolean => {
  const target = moduleOf(posix.resolve('/', file));
  return specifier.startsWith('.')
    ? moduleOf(posix.resolve('/', dirname(importer), specifier)) === target
    : basename(moduleOf(specifier)) === basename(target);
};

const importedName = (text: string, specifier: ImportDeclaration['specifiers'][number]) => {
  if (specifier.type === 'ImportSpecifier') return sourceOf(text, specifier.imported);
  return specifier.type === 'ImportDefaultSpecifier' ? 'default' : undefined;
};

type Read = { readonly path: string; readonly text: string; readonly target: string };

const usesInFile = ({ path, text, target }: Read): ReadonlyMap<string, SymbolUse> => {
  const { program, tokens } = parseTypeScript(text, path);
  const imports = program.body.filter(statement => statement.type === 'ImportDeclaration');
  const outsideImports = (token: Token) =>
    !imports.some(
      statement => startOf(token) >= startOf(statement) && endOf(token) <= endOf(statement),
    );
  const code = (tokens ?? []).filter(isToken).filter(isCode).filter(outsideImports);
  const tokenText = (token: Token | undefined) =>
    token === undefined ? '' : text.slice(startOf(token), endOf(token));
  const firstUse = (local: string) =>
    code.find(
      (token, index) => tokenText(token) === local && !ACCESSES.has(tokenText(code[index - 1])),
    );
  return new Map(
    imports
      .filter(statement => namesFile(statement.source.value, path, target))
      .flatMap(statement =>
        statement.specifiers.flatMap(specifier => {
          const imported = importedName(text, specifier);
          return imported === undefined
            ? []
            : [
                [
                  imported,
                  placeAt(path, text, startOf(firstUse(specifier.local.name) ?? statement)),
                ] as const,
              ];
        }),
      ),
  );
};

export const usesOfTypeScript = async ({
  head,
  graph,
  node,
  names,
}: UsesAsked): Promise<UsesReading> => {
  const nodes = new Map<string, GraphNode>(graph.nodes.map(each => [each.id, each]));
  const importers = graph.edges
    .filter(({ to }) => to === node.id)
    .flatMap(({ from }) => nodes.get(from) ?? []);
  const read = await Promise.all(
    importers.map(async ({ path }) =>
      usesInFile({ path, text: await readFile(join(head, path), 'utf8'), target: node.path }),
    ),
  );
  return {
    uses: Object.fromEntries(names.map(name => [name, read.flatMap(file => file.get(name) ?? [])])),
  };
};
