import { z } from 'zod';
import { type Lockfile, lockedVersions } from '../core/lockfile.ts';

const NOT_RECOGNISED = 'package-lock.json format not recognised';
const UNDER_NODE_MODULES = /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)$/;

const Declarations = z.record(z.string(), z.string()).optional();
const Lock = z.object({
  lockfileVersion: z.number(),
  packages: z
    .record(
      z.string(),
      z.object({
        version: z.string().optional(),
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

export const npmLockfile: Lockfile = {
  file: 'package-lock.json',
  ecosystem: 'npm',
  read: ({ text }) => {
    const { lockfileVersion, packages } = lockOf(text);
    if (lockfileVersion !== 2 && lockfileVersion !== 3)
      throw new Error(`package-lock.json lockfile version ${lockfileVersion}`);
    if (packages === undefined) throw new Error(NOT_RECOGNISED);
    const entries = Object.entries(packages);
    return {
      versions: lockedVersions(
        entries.flatMap(([path, { version = '' }]) => {
          const name = path.match(UNDER_NODE_MODULES)?.[1];
          return name === undefined ? [] : [{ name, version }];
        }),
      ),
      direct: new Set(
        entries
          .filter(([path]) => !UNDER_NODE_MODULES.test(path))
          .flatMap(([, { dependencies, devDependencies, optionalDependencies }]) =>
            Object.keys({ ...dependencies, ...devDependencies, ...optionalDependencies }),
          ),
      ),
    };
  },
};
