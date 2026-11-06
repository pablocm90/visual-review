import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GraphNode } from '../../core/graph.ts';
import type { SymbolUse, UsesAsked, UsesReading } from '../../core/reader.ts';
import { endOf, isCode, isToken, startOf, type Token } from './typescript-symbols.ts';
import { parseTypeScript, sourceOf } from './typescript-syntax.ts';

const placeAt = (path: string, text: string, offset: number): SymbolUse => {
  const line = text.slice(0, offset).split('\n').length;
  return { path, line, text: (text.split('\n')[line - 1] ?? '').trim() };
};

const ACCESSES = new Set(['.', '?.']);

type Read = { readonly path: string; readonly text: string };

const usesInFile = ({ path, text }: Read): ReadonlyMap<string, SymbolUse> => {
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
    imports.flatMap(statement =>
      statement.specifiers.flatMap(specifier =>
        specifier.type === 'ImportSpecifier'
          ? [
              [
                sourceOf(text, specifier.imported),
                placeAt(path, text, startOf(firstUse(specifier.local.name) ?? statement)),
              ] as const,
            ]
          : [],
      ),
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
    .filter(({ to }) => to === node)
    .flatMap(({ from }) => nodes.get(from) ?? []);
  const read = await Promise.all(
    importers.map(async ({ path }) =>
      usesInFile({ path, text: await readFile(join(head, path), 'utf8') }),
    ),
  );
  return {
    uses: Object.fromEntries(names.map(name => [name, read.flatMap(file => file.get(name) ?? [])])),
  };
};
