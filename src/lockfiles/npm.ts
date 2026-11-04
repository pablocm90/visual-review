import { z } from 'zod';
import { type Lockfile, lockedVersions } from '../core/lockfile.ts';

const NOT_RECOGNISED = 'package-lock.json format not recognised';
const UNDER_NODE_MODULES = /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)$/;
const NAMES_NODE_MODULES = /(?:^|\/)node_modules(?:\/|$)/;
const ALIAS = /^npm:((?:@[^/]+\/)?[^@]+)/;

const Declarations = z.record(z.string(), z.string()).optional();
const Lock = z.object({
  lockfileVersion: z.number(),
  packages: z
    .record(
      z.string(),
      z.object({
        name: z.string().optional(),
        version: z.string().optional(),
        link: z.literal(true).optional(),
        dependencies: Declarations,
        devDependencies: Declarations,
        optionalDependencies: Declarations,
      }),
    )
    .optional(),
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
      folder: folderOf(path),
    }));
    const linked = new Set(entries.filter(({ link }) => link).map(({ folder }) => folder));
    return {
      versions: lockedVersions(
        entries.flatMap(({ folder, link, name, version }) =>
          folder === undefined || link
            ? []
            : [{ name: name ?? folder, version: lockedVersion(version) }],
        ),
      ),
      direct: new Set(
        entries
          .filter(({ folder }) => folder === undefined)
          .flatMap(({ dependencies, devDependencies, optionalDependencies }) =>
            Object.entries({ ...dependencies, ...devDependencies, ...optionalDependencies }),
          )
          .filter(([name]) => !linked.has(name))
          .map(([name, spec]) => spec.match(ALIAS)?.[1] ?? name),
      ),
    };
  },
};
