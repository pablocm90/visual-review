import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ImportDeclaration, Node, Program } from '@babel/types';
import type { GraphNode } from '../../core/graph.ts';
import type { SymbolUse, UsesAsked, UsesReading } from '../../core/reader.ts';
import { isTooBig } from '../too-big.ts';
import {
  moduleAt,
  modulesNamedBy,
  type Naming,
  packageNameIn,
  type Resolution,
  resolutionIn,
} from './typescript-config.ts';
import { scriptsOfStack } from './typescript-outside.ts';
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

export const NOT_DRAWN =
  'not followed: type-only re-exports, files outside the source root, a package imported under another name';

const ACCESSES = new Set(['.', '?.']);
const LOADERS = new Set(['import', 'require']);

type Stack = {
  readonly head: string;
  readonly resolution: Resolution;
  readonly drawn: ReadonlySet<string>;
  readonly packageName: string | undefined;
};

const namesPackage = (packageName: string | undefined, specifier: string) =>
  packageName !== undefined &&
  (specifier === packageName || specifier.startsWith(`${packageName}/`));

const drawnPlaceNamedBy = (stack: Stack, naming: Naming) =>
  modulesNamedBy(stack, naming).find(place => stack.drawn.has(place));

const importedName = (text: string, specifier: ImportDeclaration['specifiers'][number]) => {
  if (specifier.type === 'ImportSpecifier') return sourceOf(text, specifier.imported);
  return specifier.type === 'ImportDefaultSpecifier' ? 'default' : undefined;
};

type Forward = { readonly from: string; readonly to: string };

type Sourced = { readonly source: string; readonly at: SymbolUse };

type FileFacts = {
  readonly imported: ReadonlyArray<
    Sourced & { readonly name: string; readonly local: string; readonly firstRead: SymbolUse }
  >;
  readonly namespaceReads: ReadonlyArray<Sourced & { readonly member: string | undefined }>;
  readonly reexports: ReadonlyArray<Sourced & Forward>;
  readonly namespaceExports: ReadonlyArray<Sourced>;
  readonly loads: ReadonlyArray<Sourced>;
  readonly exportsAll: ReadonlyArray<string>;
  readonly aliases: ReadonlyArray<Alias>;
  readonly members: ReadonlyMap<string, SymbolUse>;
};

type FileUses = {
  readonly named: ReadonlyMap<string, SymbolUse>;
  readonly members: ReadonlyMap<string, SymbolUse>;
  readonly unfollowed: ReadonlyArray<SymbolUse>;
  readonly forwards: ReadonlyArray<Forward>;
  readonly forwardsAll: boolean;
  readonly notRead?: string;
};

const NO_USES: FileUses = {
  named: new Map(),
  members: new Map(),
  unfollowed: [],
  forwards: [],
  forwardsAll: false,
};

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

type PlaceOf = (range: Token | Node) => SymbolUse;

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

const memberReadsOf = (scan: Scan) =>
  scan.code.flatMap((token, index) => {
    const member = scan.code[index + 1];
    return ACCESSES.has(textOf(scan, token)) && member !== undefined
      ? [{ name: textOf(scan, member), token: member }]
      : [];
  });

type Names = (specifier: string) => boolean;

const loadsOf = (scan: Scan, placeOf: PlaceOf): ReadonlyArray<Sourced> =>
  scan.code.flatMap((token, index) =>
    LOADERS.has(textOf(scan, token)) && !ACCESSES.has(textOf(scan, scan.code[index - 1]))
      ? [{ source: textOf(scan, scan.code[index + 2]).slice(1, -1), at: placeOf(token) }]
      : [],
  );

const exportsFrom = (text: string, program: Program, placeOf: PlaceOf) => {
  const specifiers = program.body.flatMap(statement => {
    if (statement.type !== 'ExportNamedDeclaration' || !statement.source) return [];
    const source = statement.source.value;
    const at = placeOf(statement);
    return statement.specifiers.map(specifier => ({ specifier, source, at }));
  });
  return {
    reexports: specifiers.flatMap(({ specifier, source, at }) =>
      specifier.type === 'ExportSpecifier'
        ? [
            {
              source,
              at,
              from: nameOf(text, specifier.local),
              to: nameOf(text, specifier.exported),
            },
          ]
        : [],
    ),
    namespaceExports: specifiers.flatMap(({ specifier, source, at }) =>
      specifier.type === 'ExportNamespaceSpecifier' ? [{ source, at }] : [],
    ),
  };
};

const factsOf = (path: string, text: string): FileFacts => {
  const parsed = parseTypeScript(text, path);
  const { program } = parsed;
  const scan = scanOf(text, parsed);
  const placeOf: PlaceOf = range => placeAt(path, text, startOf(range));
  const specifiers = program.body.flatMap(statement => {
    if (statement.type !== 'ImportDeclaration') return [];
    const source = statement.source.value;
    const at = placeOf(statement);
    return statement.specifiers.map(specifier => ({ specifier, source, at }));
  });
  const firstRead = new Map(
    memberReadsOf(scan)
      .map(({ name, token }) => [name, token] as const)
      .toReversed(),
  );
  return {
    ...exportsFrom(text, program, placeOf),
    imported: specifiers.flatMap(({ specifier, source, at }) => {
      const name = importedName(text, specifier);
      if (name === undefined) return [];
      const local = specifier.local.name;
      const read = readsOf(scan, local)[0]?.token;
      return [{ source, at, name, local, firstRead: read === undefined ? at : placeOf(read) }];
    }),
    namespaceReads: specifiers.flatMap(({ specifier, source }) =>
      specifier.type === 'ImportNamespaceSpecifier'
        ? readsOf(scan, specifier.local.name).map(({ token, member }) => ({
            source,
            member,
            at: placeOf(token),
          }))
        : [],
    ),
    loads: loadsOf(scan, placeOf),
    exportsAll: program.body.flatMap(statement =>
      statement.type === 'ExportAllDeclaration' ? [statement.source.value] : [],
    ),
    aliases: aliasesIn(text, program),
    members: new Map([...firstRead].map(([name, token]) => [name, placeOf(token)])),
  };
};

const usesFrom = (facts: FileFacts, names: Names, namesExactly: Names): FileUses => {
  const isNamed = ({ source }: Sourced) => names(source);
  const isLoose = (name: string, source: string) => name === 'default' && !namesExactly(source);
  const mayUse = ({ at }: Sourced): SymbolUse => ({ ...at, unfollowed: true });
  const reexports = facts.reexports.filter(isNamed);
  const imported = facts.imported.filter(isNamed);
  const namespaceReads = facts.namespaceReads.filter(isNamed);
  return {
    named: new Map([
      ...reexports.map(
        reexport =>
          [
            reexport.from,
            isLoose(reexport.from, reexport.source) ? mayUse(reexport) : reexport.at,
          ] as const,
      ),
      ...imported.map(
        each =>
          [each.name, isLoose(each.name, each.source) ? mayUse(each) : each.firstRead] as const,
      ),
      ...namespaceReads
        .flatMap(({ member, at }) => (member === undefined ? [] : [[member, at] as const]))
        .toReversed(),
    ]),
    members: facts.members,
    unfollowed: [
      ...namespaceReads.filter(({ member }) => member === undefined),
      ...facts.loads.filter(isNamed),
      ...facts.namespaceExports.filter(isNamed),
    ].map(mayUse),
    forwards: [
      ...reexports.filter(({ source, from }) => !isLoose(from, source)),
      ...imported
        .filter(({ source, name }) => !isLoose(name, source))
        .flatMap(({ name, local }) =>
          facts.aliases
            .filter(alias => alias.local === local)
            .map(({ exported }) => ({ from: name, to: exported })),
        ),
    ],
    forwardsAll: facts.exportsAll.some(names),
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

type Read = FileFacts | { readonly notRead: true } | undefined;

const readFacts = async (path: string, file: string): Promise<Read> => {
  const text = await readFile(file, 'utf8').catch(() => undefined);
  if (text === undefined) return undefined;
  if (isTooBig(text)) return { notRead: true };
  try {
    return factsOf(path, text);
  } catch {
    return { notRead: true };
  }
};

const known = new Map<string, Promise<Read>>();

const factsAt = (head: string, path: string): Promise<Read> => {
  const file = join(head, path);
  const kept = known.get(file);
  if (kept !== undefined) return kept;
  const read = readFacts(path, file);
  known.set(file, read);
  return read;
};

const fileUsesAt = async (stack: Stack, path: string, target: string): Promise<FileUses> => {
  const facts = await factsAt(stack.head, path);
  if (facts === undefined) return NO_USES;
  if ('notRead' in facts) return { ...NO_USES, notRead: path };
  const placeOfName = (specifier: string) =>
    drawnPlaceNamedBy(stack, { specifier, importer: path });
  const namesExactly: Names = specifier => placeOfName(specifier) === moduleAt(stack.head, target);
  const names: Names = specifier =>
    namesExactly(specifier) ||
    (placeOfName(specifier) === undefined && namesPackage(stack.packageName, specifier));
  return usesFrom(facts, names, namesExactly);
};

const rowOf = ({ exported, asked }: Hop, { named, members, unfollowed }: FileUses) => {
  const [, member] = asked.split('.');
  const held = named.get(exported);
  const namesAlone = member === undefined || member === 'constructor' || held?.unfollowed;
  const row = namesAlone ? held : held && members.get(member);
  return row ?? unfollowed[0] ?? [];
};

const onePerFile = (uses: ReadonlyArray<SymbolUse>): ReadonlyArray<SymbolUse> => {
  const ordered = [...uses.filter(use => !use.unfollowed), ...uses.filter(use => use.unfollowed)];
  return ordered.filter(
    (use, index) => ordered.findIndex(({ path }) => path === use.path) === index,
  );
};

const isUnbackedAll = (name: string) => name.startsWith('* from ');

export const usesOfTypeScript = async ({
  base,
  head,
  stacks,
  graph,
  node,
  names,
}: UsesAsked): Promise<UsesReading> => {
  const drawnPaths = new Set(graph.nodes.map(({ path }) => path));
  const outside: ReadonlyArray<GraphNode> = [...stacks].flatMap(([root, stack]) =>
    scriptsOfStack({ head, root, roots: [...stacks.keys()] })
      .filter(path => !drawnPaths.has(path))
      .map(path => ({
        id: `${stack}/outside/${path}`,
        kind: 'file' as const,
        label: path,
        parent: stack,
        path,
      })),
  );
  const nodes = new Map<string, GraphNode>(
    [...graph.nodes, ...outside].map(each => [each.id, each]),
  );
  const baseText = await readFile(join(base, node.path), 'utf8');
  const aliases = aliasesIn(baseText, parseTypeScript(baseText, node.path).program);
  const stackOf = (id: string): string => {
    const parent = nodes.get(id)?.parent;
    return parent === undefined ? id : stackOf(parent);
  };
  const rootOf = (id: string): string =>
    [...stacks].find(([, stack]) => stack === stackOf(id))?.[0] ?? '.';
  const resolutions = new Map<string, Resolution>();
  const resolutionOf = (root: string): Resolution => {
    const kept = resolutions.get(root);
    if (kept !== undefined) return kept;
    const resolution = resolutionIn({ checkout: head, root });
    resolutions.set(root, resolution);
    return resolution;
  };
  const drawn = new Set(
    [...graph.nodes, ...outside]
      .filter(({ kind }) => kind === 'file')
      .map(({ path }) => moduleAt(head, path)),
  );
  const visits = await walked({
    hops: names.flatMap(asked => {
      const [owner = asked] = asked.split('.');
      return [
        owner,
        ...aliases.filter(({ local }) => local === owner).map(({ exported }) => exported),
      ].map(exported => ({ node, exported, asked }));
    }),
    seen: new Set(),
    importersOf: ({ id }) => [
      ...graph.edges
        .filter(({ to }) => to === id || to === stackOf(id))
        .flatMap(({ from }) => nodes.get(from) ?? []),
      ...outside,
    ],
    read: ({ id, path }, target) =>
      fileUsesAt(
        {
          head,
          drawn,
          resolution: resolutionOf(rootOf(id)),
          packageName:
            rootOf(id) === rootOf(target.id)
              ? undefined
              : packageNameIn(join(base, rootOf(target.id))),
        },
        path,
        target.path,
      ),
  });
  return {
    uses: Object.fromEntries(
      names.map(name => [
        name,
        onePerFile(visits.flatMap(({ hop, uses }) => (hop.asked === name ? rowOf(hop, uses) : []))),
      ]),
    ),
    notRead: [...new Set(visits.flatMap(({ uses }) => uses.notRead ?? []))],
    notFollowed: [
      NOT_DRAWN,
      ...(names.some(name => !isUnbackedAll(name) && name.includes('.'))
        ? ['not followed: a method read other than by `.name`, or without importing its class']
        : []),
      ...(names.some(isUnbackedAll) ? ['removed export * not followed'] : []),
    ],
  };
};
