import { type Lockfile, lockedVersions } from '../core/lockfile.ts';

const PACKAGE_KEY = /^ {2}(?:'([^']+)'|([^\s'"]+)):$/gm;
const DECLARATIONS =
  /^ {4}(?:dependencies|devDependencies|optionalDependencies):\n((?: {6}.*\n?)*)/gm;
const DECLARED = /^ {6}'?([^\s':]+)'?:\n {8}specifier: .*\n {8}version: '?([^'\s]+)'?$/gm;

const sectionOf = (text: string, name: string): string =>
  text.match(new RegExp(`^${name}:\\n([^]*?)(?=^\\S|(?![^]))`, 'm'))?.[1] ?? '';

const splitAtVersion = (key: string): readonly [string, string] => {
  const at = key.indexOf('@', 1);
  return [key.slice(0, at), key.slice(at + 1)];
};

const declaredName = (name: string, version: string): ReadonlyArray<string> => {
  if (version.startsWith('link:')) return [];
  const resolved = version.split('(')[0] ?? '';
  return [/^(?:@[^/]+\/)?[^@/:]+@/.test(resolved) ? splitAtVersion(resolved)[0] : name];
};

export const pnpmLockfile: Lockfile = {
  file: 'pnpm-lock.yaml',
  ecosystem: 'npm',
  read: ({ text }) => {
    const major = text.match(/^lockfileVersion: '?(\d+)/m)?.[1];
    if (major === undefined) throw new Error('pnpm-lock.yaml format not recognised');
    if (major !== '9') throw new Error(`pnpm-lock.yaml lockfile version ${major}`);
    const packages = [...sectionOf(text, 'packages').matchAll(PACKAGE_KEY)];
    const declarations = [...sectionOf(text, 'importers').matchAll(DECLARATIONS)];
    return {
      versions: lockedVersions(
        packages.map(([, quoted, plain]) => {
          const [name, version] = splitAtVersion(quoted ?? plain ?? '');
          return { name, version };
        }),
      ),
      direct: new Set(
        declarations
          .flatMap(([, entries = '']) => [...entries.matchAll(DECLARED)])
          .flatMap(([, name = '', version = '']) => declaredName(name, version)),
      ),
    };
  },
};
