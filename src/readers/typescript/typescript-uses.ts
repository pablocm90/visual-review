import { readFile } from 'node:fs/promises';
import { basename, dirname, join, posix } from 'node:path';
import type { ImportDeclaration, Node } from '@babel/types';
import type { GraphNode } from '../../core/graph.ts';
import type { SymbolUse, UsesAsked, UsesReading } from '../../core/reader.ts';
import {
  defaultExported,
  endOf,
  isCode,
  isToken,
  startOf,
  type Token,
} from './typescript-symbols.ts';
import { nameOf, parseTypeScript, sourceOf } from './typescript-syntax.ts';

const placeAt = (path: string, text: string, offset: number): SymbolUse => {
  const line = text.slice(0, offset).split('\n').length;
  return { path, line, text: (text.split('\n')[line - 1] ?? '').trim() };
};

const ACCESSES = new Set(['.', '?.']);
const LOADERS = new Set(['import', 'require']);

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

type Forward = { readonly from: string; readonly to: string };

type FileUses = {
  readonly named: ReadonlyMap<string, SymbolUse>;
  readonly unfollowed: ReadonlyArray<SymbolUse>;
  readonly forwards: ReadonlyArray<Forward>;
};

const usesInFile = ({ path, text, target }: Read): FileUses => {
  const { program, tokens } = parseTypeScript(text, path);
  const imports = program.body.filter(statement => statement.type === 'ImportDeclaration');
  const outsideImports = (token: Token) =>
    !imports.some(
      statement => startOf(token) >= startOf(statement) && endOf(token) <= endOf(statement),
    );
  const code = (tokens ?? []).filter(isToken).filter(isCode).filter(outsideImports);
  const tokenText = (token: Token | undefined) =>
    token === undefined ? '' : text.slice(startOf(token), endOf(token));
  const readsOf = (local: string) =>
    code.flatMap((token, index) =>
      tokenText(token) === local && !ACCESSES.has(tokenText(code[index - 1]))
        ? [
            {
              token,
              member: ACCESSES.has(tokenText(code[index + 1]))
                ? tokenText(code[index + 2])
                : undefined,
            },
          ]
        : [],
    );
  const placeOf = (range: Token | Node) => placeAt(path, text, startOf(range));
  const loads = code.filter(
    (token, index) =>
      LOADERS.has(tokenText(token)) &&
      !ACCESSES.has(tokenText(code[index - 1])) &&
      namesFile(tokenText(code[index + 2]).slice(1, -1), path, target),
  );
  const exportsFrom = program.body.flatMap(statement =>
    statement.type === 'ExportNamedDeclaration' &&
    statement.source &&
    namesFile(statement.source.value, path, target)
      ? statement.specifiers.map(specifier => ({ statement, specifier }))
      : [],
  );
  const reexports = exportsFrom.flatMap(({ statement, specifier }) =>
    specifier.type === 'ExportSpecifier'
      ? [
          {
            statement,
            from: nameOf(text, specifier.local),
            to: nameOf(text, specifier.exported),
          },
        ]
      : [],
  );
  const namespaceExports = exportsFrom.flatMap(({ statement, specifier }) =>
    specifier.type === 'ExportNamespaceSpecifier' ? [statement] : [],
  );
  const specifiers = imports
    .filter(statement => namesFile(statement.source.value, path, target))
    .flatMap(statement => statement.specifiers.map(specifier => ({ statement, specifier })));
  const namespaceReads = specifiers.flatMap(({ specifier }) =>
    specifier.type === 'ImportNamespaceSpecifier' ? readsOf(specifier.local.name) : [],
  );
  const imported = specifiers.flatMap(({ statement, specifier }) => {
    const name = importedName(text, specifier);
    return name === undefined
      ? []
      : [[name, placeOf(readsOf(specifier.local.name)[0]?.token ?? statement)] as const];
  });
  const members = namespaceReads.flatMap(({ token, member }) =>
    member === undefined ? [] : [[member, placeOf(token)] as const],
  );
  return {
    named: new Map([
      ...reexports.map(({ statement, from }) => [from, placeOf(statement)] as const),
      ...imported,
      ...members.toReversed(),
    ]),
    unfollowed: [
      ...namespaceReads.filter(({ member }) => member === undefined).map(({ token }) => token),
      ...loads,
      ...namespaceExports,
    ].map(range => ({ ...placeOf(range), unfollowed: true })),
    forwards: reexports.map(({ from, to }) => ({ from, to })),
  };
};

type Alias = { readonly local: string; readonly exported: string };

const aliasesIn = (text: string, path: string): ReadonlyArray<Alias> =>
  parseTypeScript(text, path).program.body.flatMap((statement): ReadonlyArray<Alias> => {
    if (statement.type === 'ExportDefaultDeclaration')
      return defaultExported(text, statement.declaration).map(local => ({
        local,
        exported: 'default',
      }));
    if (statement.type !== 'ExportNamedDeclaration' || statement.source) return [];
    return statement.specifiers.flatMap(specifier =>
      specifier.type === 'ExportSpecifier'
        ? [{ local: nameOf(text, specifier.local), exported: nameOf(text, specifier.exported) }]
        : [],
    );
  });

type Target = Pick<GraphNode, 'id' | 'path'>;

type Hop = { readonly node: Target; readonly exported: string; readonly asked: string };

type Walk = {
  readonly hops: ReadonlyArray<Hop>;
  readonly seen: ReadonlySet<string>;
  readonly importersOf: (node: Target) => ReadonlyArray<Target>;
  readonly read: (importer: Target, target: Target) => Promise<FileUses>;
};

type Row = { readonly asked: string; readonly use: SymbolUse };

const keyOf = ({ node, exported, asked }: Hop) => JSON.stringify([node.id, exported, asked]);

const walked = async ({ hops, seen, importersOf, read }: Walk): Promise<ReadonlyArray<Row>> => {
  const fresh = [...new Map(hops.map(hop => [keyOf(hop), hop])).entries()].filter(
    ([key]) => !seen.has(key),
  );
  if (fresh.length === 0) return [];
  const targets = [...new Map(fresh.map(([, { node }]) => [node.id, node])).values()];
  const visits = await Promise.all(
    targets.flatMap(target =>
      importersOf(target).map(async importer => ({
        target,
        importer,
        uses: await read(importer, target),
      })),
    ),
  );
  const met = visits.flatMap(({ target, importer, uses }) =>
    fresh.flatMap(([, hop]) => (hop.node.id === target.id ? [{ hop, importer, uses }] : [])),
  );
  const rows = met.flatMap(({ hop, uses }) => {
    const use = uses.named.get(hop.exported) ?? uses.unfollowed[0];
    return use === undefined ? [] : [{ asked: hop.asked, use }];
  });
  const next = met.flatMap(({ hop, importer, uses }) =>
    uses.forwards
      .filter(({ from }) => from === hop.exported)
      .map(({ to }) => ({ node: importer, exported: to, asked: hop.asked })),
  );
  return [
    ...rows,
    ...(await walked({
      hops: next,
      seen: new Set([...seen, ...fresh.map(([key]) => key)]),
      importersOf,
      read,
    })),
  ];
};

const onePerFile = (uses: ReadonlyArray<SymbolUse>): ReadonlyArray<SymbolUse> => {
  const ordered = [...uses.filter(use => !use.unfollowed), ...uses.filter(use => use.unfollowed)];
  return ordered.filter(
    (use, index) => ordered.findIndex(({ path }) => path === use.path) === index,
  );
};

export const usesOfTypeScript = async ({
  base,
  head,
  graph,
  node,
  names,
}: UsesAsked): Promise<UsesReading> => {
  const nodes = new Map<string, GraphNode>(graph.nodes.map(each => [each.id, each]));
  const aliases = aliasesIn(await readFile(join(base, node.path), 'utf8'), node.path);
  const rows = await walked({
    hops: names.flatMap(asked =>
      [
        asked,
        ...aliases.filter(({ local }) => local === asked).map(({ exported }) => exported),
      ].map(exported => ({ node, exported, asked })),
    ),
    seen: new Set(),
    importersOf: ({ id }) =>
      graph.edges.filter(({ to }) => to === id).flatMap(({ from }) => nodes.get(from) ?? []),
    read: async ({ path }, target) =>
      usesInFile({ path, text: await readFile(join(head, path), 'utf8'), target: target.path }),
  });
  return {
    uses: Object.fromEntries(
      names.map(name => [
        name,
        onePerFile(rows.filter(({ asked }) => asked === name).map(({ use }) => use)),
      ]),
    ),
  };
};
