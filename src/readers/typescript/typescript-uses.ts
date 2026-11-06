import { readFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import type { ImportDeclaration, Node, Program } from '@babel/types';
import type { GraphNode } from '../../core/graph.ts';
import type { SymbolUse, UsesAsked, UsesReading } from '../../core/reader.ts';
import { isTooBig } from '../too-big.ts';
import {
  packageNameIn,
  placesNamedBy,
  type Resolution,
  resolutionIn,
} from './typescript-config.ts';
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

export const NOT_DRAWN = 'not followed: type-only re-exports, files outside the source root';

const ACCESSES = new Set(['.', '?.']);
const LOADERS = new Set(['import', 'require']);

const moduleOf = (path: string): string => {
  const stem = path.replace(/(\.d)?\.[cm]?[jt]sx?$/, '');
  return basename(stem) === 'index' ? dirname(stem) : stem;
};

type Stack = {
  readonly head: string;
  readonly resolution: Resolution;
  readonly drawn: ReadonlySet<string>;
  readonly packageName: string | undefined;
};

type Naming = { readonly specifier: string; readonly importer: string; readonly file: string };

const moduleAt = (...path: ReadonlyArray<string>): string => moduleOf(resolve(...path));

const namesPackage = (packageName: string | undefined, specifier: string) =>
  packageName !== undefined &&
  (specifier === packageName || specifier.startsWith(`${packageName}/`));

const namesFile = ({ head, resolution, drawn }: Stack, { specifier, importer, file }: Naming) => {
  const places = specifier.startsWith('.')
    ? [join(head, dirname(importer), specifier)]
    : placesNamedBy(resolution, specifier);
  return (
    places.map(place => moduleAt(place)).find(place => drawn.has(place)) === moduleAt(head, file)
  );
};

const importedName = (text: string, specifier: ImportDeclaration['specifiers'][number]) => {
  if (specifier.type === 'ImportSpecifier') return sourceOf(text, specifier.imported);
  return specifier.type === 'ImportDefaultSpecifier' ? 'default' : undefined;
};

type Read = {
  readonly path: string;
  readonly text: string;
  readonly target: string;
  readonly stack: Stack;
};

type Forward = { readonly from: string; readonly to: string };

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

const loadsOf = (scan: Scan, names: Names) =>
  scan.code.filter(
    (token, index) =>
      LOADERS.has(textOf(scan, token)) &&
      !ACCESSES.has(textOf(scan, scan.code[index - 1])) &&
      names(textOf(scan, scan.code[index + 2]).slice(1, -1)),
  );

const exportsFrom = (text: string, program: Program, names: Names) => {
  const specifiers = program.body.flatMap(statement => {
    if (statement.type !== 'ExportNamedDeclaration' || !statement.source) return [];
    const source = statement.source.value;
    return names(source)
      ? statement.specifiers.map(specifier => ({ statement, specifier, source }))
      : [];
  });
  return {
    reexports: specifiers.flatMap(({ statement, specifier, source }) =>
      specifier.type === 'ExportSpecifier'
        ? [
            {
              statement,
              source,
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

const usesInFile = ({ path, text, target, stack }: Read): FileUses => {
  const parsed = parseTypeScript(text, path);
  const { program } = parsed;
  const scan = scanOf(text, parsed);
  const namesExactly: Names = specifier =>
    namesFile(stack, { specifier, importer: path, file: target });
  const names: Names = specifier =>
    namesExactly(specifier) || namesPackage(stack.packageName, specifier);
  const isLoose = (name: string, source: string) => name === 'default' && !namesExactly(source);
  const placeOf = (range: Token | Node) => placeAt(path, text, startOf(range));
  const mayUseAt = (range: Token | Node): SymbolUse => ({ ...placeOf(range), unfollowed: true });
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
      ...reexports.map(
        ({ statement, source, from }) =>
          [from, isLoose(from, source) ? mayUseAt(statement) : placeOf(statement)] as const,
      ),
      ...imported.map(
        ({ statement, name, local }) =>
          [
            name,
            isLoose(name, statement.source.value)
              ? mayUseAt(statement)
              : placeOf(readsOf(scan, local)[0]?.token ?? statement),
          ] as const,
      ),
      ...members.toReversed(),
    ]),
    members: new Map(
      memberReadsOf(scan)
        .map(({ name, token }) => [name, placeOf(token)] as const)
        .toReversed(),
    ),
    unfollowed: [
      ...namespaceReads.filter(({ member }) => member === undefined).map(({ token }) => token),
      ...loadsOf(scan, names),
      ...namespaceExports,
    ].map(mayUseAt),
    forwards: [
      ...reexports.filter(({ source, from }) => !isLoose(from, source)),
      ...imported
        .filter(({ statement, name }) => !isLoose(name, statement.source.value))
        .flatMap(({ name, local }) =>
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

const known = new Map<string, FileUses>();

const usesInFileOnce = (read: Read): FileUses => {
  const key = JSON.stringify([read.path, read.target, read.text, read.stack.resolution]);
  const kept = known.get(key);
  if (kept !== undefined) return kept;
  const uses = usesInFile(read);
  known.set(key, uses);
  return uses;
};

const fileUsesAt = async (stack: Stack, path: string, target: string): Promise<FileUses> => {
  const text = await readFile(join(stack.head, path), 'utf8').catch(() => undefined);
  if (text === undefined) return NO_USES;
  if (isTooBig(text)) return { ...NO_USES, notRead: path };
  try {
    return usesInFileOnce({ path, text, target, stack });
  } catch {
    return { ...NO_USES, notRead: path };
  }
};

const rowOf = ({ exported, asked }: Hop, { named, members, unfollowed }: FileUses) => {
  const [, member] = asked.split('.');
  const held = named.get(exported);
  const row = member === undefined || held?.unfollowed ? held : held && members.get(member);
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
  const nodes = new Map<string, GraphNode>(graph.nodes.map(each => [each.id, each]));
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
    graph.nodes.filter(({ kind }) => kind === 'file').map(({ path }) => moduleAt(head, path)),
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
    importersOf: ({ id }) =>
      graph.edges
        .filter(({ to }) => to === id || to === stackOf(id))
        .flatMap(({ from }) => nodes.get(from) ?? []),
    read: ({ id, path }, target) =>
      fileUsesAt(
        {
          head,
          drawn,
          resolution: resolutionOf(rootOf(id)),
          packageName: packageNameIn(join(base, rootOf(target.id))),
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
        ? ['not followed: a method read without importing its class']
        : []),
      ...(names.some(isUnbackedAll) ? ['removed export * not followed'] : []),
    ],
  };
};
