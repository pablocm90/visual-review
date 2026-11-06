import { readFile } from 'node:fs/promises';
import { basename, dirname, join, posix } from 'node:path';
import type { ImportDeclaration, Node, Program } from '@babel/types';
import type { GraphNode } from '../../core/graph.ts';
import type { SymbolUse, UsesAsked, UsesReading } from '../../core/reader.ts';
import { isTooBig } from '../too-big.ts';
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
  const stem = path.replace(/(\.d)?\.[cm]?[jt]sx?$/, '');
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
  readonly forwardsAll: boolean;
  readonly notRead?: string;
};

const NO_USES: FileUses = { named: new Map(), unfollowed: [], forwards: [], forwardsAll: false };

type Alias = { readonly local: string; readonly exported: string };

const aliasesIn = (text: string, program: Program): ReadonlyArray<Alias> =>
  program.body.flatMap((statement): ReadonlyArray<Alias> => {
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

type Scan = { readonly text: string; readonly code: ReadonlyArray<Token> };

const scanOf = (text: string, { program, tokens }: ReturnType<typeof parseTypeScript>): Scan => {
  const imports = program.body.filter(statement => statement.type === 'ImportDeclaration');
  const outsideImports = (token: Token) =>
    !imports.some(
      statement => startOf(token) >= startOf(statement) && endOf(token) <= endOf(statement),
    );
  return { text, code: (tokens ?? []).filter(isToken).filter(isCode).filter(outsideImports) };
};

const textOf = ({ text }: Scan, token: Token | undefined) =>
  token === undefined ? '' : text.slice(startOf(token), endOf(token));

const readsOf = (scan: Scan, local: string) =>
  scan.code.flatMap((token, index) =>
    textOf(scan, token) === local && !ACCESSES.has(textOf(scan, scan.code[index - 1]))
      ? [
          {
            token,
            member: ACCESSES.has(textOf(scan, scan.code[index + 1]))
              ? textOf(scan, scan.code[index + 2])
              : undefined,
          },
        ]
      : [],
  );

type Names = (specifier: string) => boolean;

const loadsOf = (scan: Scan, names: Names) =>
  scan.code.filter(
    (token, index) =>
      LOADERS.has(textOf(scan, token)) &&
      !ACCESSES.has(textOf(scan, scan.code[index - 1])) &&
      names(textOf(scan, scan.code[index + 2]).slice(1, -1)),
  );

const exportsFrom = (text: string, program: Program, names: Names) => {
  const specifiers = program.body.flatMap(statement =>
    statement.type === 'ExportNamedDeclaration' && statement.source && names(statement.source.value)
      ? statement.specifiers.map(specifier => ({ statement, specifier }))
      : [],
  );
  return {
    reexports: specifiers.flatMap(({ statement, specifier }) =>
      specifier.type === 'ExportSpecifier'
        ? [
            {
              statement,
              from: nameOf(text, specifier.local),
              to: nameOf(text, specifier.exported),
            },
          ]
        : [],
    ),
    namespaceExports: specifiers.flatMap(({ statement, specifier }) =>
      specifier.type === 'ExportNamespaceSpecifier' ? [statement] : [],
    ),
  };
};

const usesInFile = ({ path, text, target }: Read): FileUses => {
  const parsed = parseTypeScript(text, path);
  const { program } = parsed;
  const scan = scanOf(text, parsed);
  const names: Names = specifier => namesFile(specifier, path, target);
  const placeOf = (range: Token | Node) => placeAt(path, text, startOf(range));
  const { reexports, namespaceExports } = exportsFrom(text, program, names);
  const aliases = aliasesIn(text, program);
  const specifiers = program.body.flatMap(statement =>
    statement.type === 'ImportDeclaration' && names(statement.source.value)
      ? statement.specifiers.map(specifier => ({ statement, specifier }))
      : [],
  );
  const namespaceReads = specifiers.flatMap(({ specifier }) =>
    specifier.type === 'ImportNamespaceSpecifier' ? readsOf(scan, specifier.local.name) : [],
  );
  const imported = specifiers.flatMap(({ statement, specifier }) => {
    const name = importedName(text, specifier);
    return name === undefined ? [] : [{ statement, name, local: specifier.local.name }];
  });
  const members = namespaceReads.flatMap(({ token, member }) =>
    member === undefined ? [] : [[member, placeOf(token)] as const],
  );
  return {
    named: new Map([
      ...reexports.map(({ statement, from }) => [from, placeOf(statement)] as const),
      ...imported.map(
        ({ statement, name, local }) =>
          [name, placeOf(readsOf(scan, local)[0]?.token ?? statement)] as const,
      ),
      ...members.toReversed(),
    ]),
    unfollowed: [
      ...namespaceReads.filter(({ member }) => member === undefined).map(({ token }) => token),
      ...loadsOf(scan, names),
      ...namespaceExports,
    ].map(range => ({ ...placeOf(range), unfollowed: true })),
    forwards: [
      ...reexports,
      ...imported.flatMap(({ name, local }) =>
        aliases
          .filter(alias => alias.local === local)
          .map(({ exported }) => ({ from: name, to: exported })),
      ),
    ],
    forwardsAll: program.body.some(
      statement => statement.type === 'ExportAllDeclaration' && names(statement.source.value),
    ),
  };
};

type Target = Pick<GraphNode, 'id' | 'path'>;

type Hop = { readonly node: Target; readonly exported: string; readonly asked: string };

type Walk = {
  readonly hops: ReadonlyArray<Hop>;
  readonly seen: ReadonlySet<string>;
  readonly importersOf: (node: Target) => ReadonlyArray<Target>;
  readonly read: (importer: Target, target: Target) => Promise<FileUses>;
};

type Visit = { readonly hop: Hop; readonly uses: FileUses };

const keyOf = ({ node, exported, asked }: Hop) => JSON.stringify([node.id, exported, asked]);

const walked = async ({ hops, seen, importersOf, read }: Walk): Promise<ReadonlyArray<Visit>> => {
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
  const next = met.flatMap(({ hop, importer, uses }) =>
    [
      ...uses.forwards.filter(({ from }) => from === hop.exported).map(({ to }) => to),
      ...(uses.forwardsAll && hop.exported !== 'default' ? [hop.exported] : []),
    ].map(exported => ({ node: importer, exported, asked: hop.asked })),
  );
  return [
    ...met,
    ...(await walked({
      hops: next,
      seen: new Set([...seen, ...fresh.map(([key]) => key)]),
      importersOf,
      read,
    })),
  ];
};

const fileUsesAt = async (head: string, path: string, target: string): Promise<FileUses> => {
  const text = await readFile(join(head, path), 'utf8').catch(() => undefined);
  if (text === undefined) return NO_USES;
  if (isTooBig(text)) return { ...NO_USES, notRead: path };
  try {
    return usesInFile({ path, text, target });
  } catch {
    return { ...NO_USES, notRead: path };
  }
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
  const baseText = await readFile(join(base, node.path), 'utf8');
  const aliases = aliasesIn(baseText, parseTypeScript(baseText, node.path).program);
  const visits = await walked({
    hops: names.flatMap(asked =>
      [
        asked,
        ...aliases.filter(({ local }) => local === asked).map(({ exported }) => exported),
      ].map(exported => ({ node, exported, asked })),
    ),
    seen: new Set(),
    importersOf: ({ id }) =>
      graph.edges.filter(({ to }) => to === id).flatMap(({ from }) => nodes.get(from) ?? []),
    read: ({ path }, target) => fileUsesAt(head, path, target.path),
  });
  return {
    uses: Object.fromEntries(
      names.map(name => [
        name,
        onePerFile(
          visits.flatMap(({ hop, uses }) =>
            hop.asked === name ? (uses.named.get(hop.exported) ?? uses.unfollowed[0] ?? []) : [],
          ),
        ),
      ]),
    ),
    notRead: [...new Set(visits.flatMap(({ uses }) => uses.notRead ?? []))],
  };
};
