import { z } from 'zod';
import { type Lockfile, lockedVersions } from '../core/lockfile.ts';

const NOT_RECOGNISED = 'package-lock.json format not recognised';
const UNDER_NODE_MODULES = /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)$/;
const NAMES_NODE_MODULES = /(?:^|\/)node_modules(?:\/|$)/;
const ALIAS = /^npm:((?:@[^/]+\/)?[^@]+)/;

const Declarations = z.record(z.string(), z.string()).optional();
const Entry = z.object({
  name: z.string().optional(),
  version: z.string().optional(),
  link: z.literal(true).optional(),
  resolved: z.string().optional(),
  dependencies: Declarations,
  devDependencies: Declarations,
  optionalDependencies: Declarations,
});
type Entry = z.infer<typeof Entry>;
const Lock = z.object({
  lockfileVersion: z.number(),
  packages: z.record(z.string(), Entry).optional(),
});

const lockOf = (text: string): z.infer<typeof Lock> => {
  try {
    return Lock.parse(JSON.parse(text));
  } catch {
    throw new Error(NOT_RECOGNISED);
  }
};

const folderOf = (path: string): string | undefined => {
  const folder = path.match(UNDER_NODE_MODULES)?.[1];
  if (folder === undefined && NAMES_NODE_MODULES.test(path)) throw new Error(NOT_RECOGNISED);
  return folder;
};

const declarationsOf = ({
  dependencies,
  devDependencies,
  optionalDependencies,
}: Entry): ReadonlyArray<[string, string]> => [
  ...Object.entries(dependencies ?? {}),
  ...Object.entries(devDependencies ?? {}),
  ...Object.entries(optionalDependencies ?? {}),
];

const lockedVersion = (version: string | undefined): string => {
  if (version === undefined) throw new Error(NOT_RECOGNISED);
  return version;
};

export const npmLockfile: Lockfile = {
  file: 'package-lock.json',
  ecosystem: 'npm',
  read: ({ text }) => {
    const { lockfileVersion, packages } = lockOf(text);
    if (lockfileVersion !== 2 && lockfileVersion !== 3)
      throw new Error(`package-lock.json lockfile version ${lockfileVersion}`);
    if (packages === undefined) throw new Error(NOT_RECOGNISED);
    const entries = Object.entries(packages).map(([path, entry]) => ({
      ...entry,
      path,
      folder: folderOf(path),
    }));
    const locals: ReadonlySet<string | undefined> = new Set(
      entries.filter(({ folder }) => folder === undefined).map(({ path }) => path),
    );
    if (entries.some(({ link, resolved }) => link && !locals.has(resolved)))
      throw new Error(NOT_RECOGNISED);
    const linked = new Set(entries.filter(({ link }) => link).map(({ folder }) => folder));
    const declarations = entries.flatMap(declarationsOf);
    const nameOf = (folder: string, name: string | undefined): string =>
      name !== undefined &&
      declarations.some(
        ([declared, spec]) => declared === folder && spec.match(ALIAS)?.[1] === name,
      )
        ? name
        : folder;
    return {
      versions: lockedVersions(
        entries.flatMap(({ folder, link, name, version }) =>
          folder === undefined || link
            ? []
            : [{ name: nameOf(folder, name), version: lockedVersion(version) }],
        ),
      ),
      direct: new Set(
        entries
          .filter(({ folder }) => folder === undefined)
          .flatMap(declarationsOf)
          .filter(([name]) => !linked.has(name))
          .map(([name, spec]) => spec.match(ALIAS)?.[1] ?? name),
      ),
    };
  },
};
