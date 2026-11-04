import { z } from 'zod';
import { type Lockfile, lockedVersions } from '../core/lockfile.ts';
import { aliasOf, declarationsOf, Manifest } from './npm-manifest.ts';

const NOT_RECOGNISED = 'format not recognised';
const UNDER_NODE_MODULES = /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)$/;
const NAMES_NODE_MODULES = /(?:^|\/)node_modules(?:\/|$)/;

const Entry = Manifest.extend({
  name: z.string().optional(),
  version: z.string().optional(),
  link: z.literal(true).optional(),
  resolved: z.string().optional(),
});
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

const lockedVersion = (version: string | undefined): string => {
  if (version === undefined) throw new Error(NOT_RECOGNISED);
  return version;
};

const entriesOf = (text: string) => {
  const { lockfileVersion, packages } = lockOf(text);
  if (lockfileVersion !== 2 && lockfileVersion !== 3)
    throw new Error(`lockfile version ${lockfileVersion}`);
  if (packages === undefined) throw new Error(NOT_RECOGNISED);
  return Object.entries(packages).map(([path, entry]) => ({
    ...entry,
    path,
    folder: folderOf(path),
  }));
};

const assertLinksStayLocal = (entries: ReturnType<typeof entriesOf>): void => {
  const locals: ReadonlySet<string | undefined> = new Set(
    entries.filter(({ folder }) => folder === undefined).map(({ path }) => path),
  );
  if (entries.some(({ link, resolved }) => link && !locals.has(resolved)))
    throw new Error(NOT_RECOGNISED);
};

export const npmLockfile: Lockfile = {
  file: 'package-lock.json',
  ecosystem: 'npm',
  read: ({ text }) => {
    const entries = entriesOf(text);
    assertLinksStayLocal(entries);
    const byPath = new Map(entries.map(entry => [entry.path, entry]));
    const installedFor = (declarer: string, name: string) =>
      byPath.get(`${declarer && `${declarer}/`}node_modules/${name}`) ??
      byPath.get(`node_modules/${name}`);
    const declarations = entries.flatMap(declarationsOf);
    const nameOf = (folder: string, name: string | undefined): string =>
      name !== undefined &&
      declarations.some(([declared, spec]) => declared === folder && aliasOf(spec) === name)
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
          .flatMap(declarer =>
            declarationsOf(declarer).flatMap(([name]) => {
              const installed = installedFor(declarer.path, name);
              return installed?.link ? [] : [nameOf(name, installed?.name)];
            }),
          ),
      ),
    };
  },
};
