import { type Lockfile, lockedVersions } from '../core/lockfile.ts';

const fieldOf = (block: string, field: string): string =>
  block.match(new RegExp(`^${field} = "(.+)"$`, 'm'))?.[1] ?? '';

const dependenciesOf = (block: string): ReadonlyArray<string> =>
  [
    ...(block.match(/^dependencies = \[\n([^\]]*)\]/m)?.[1] ?? '').matchAll(/^ "([^" ]+)/gm),
  ].flatMap(([, name]) => name ?? []);

export const cargoLockfile: Lockfile = {
  file: 'Cargo.lock',
  ecosystem: 'cargo',
  read: ({ text }) => {
    if (!/^\[\[package\]\]$/m.test(text)) throw new Error('Cargo.lock format not recognised');
    const packages = text.split(/^\[/m).filter(block => block.startsWith('[package]]'));
    const isLocal = (block: string) => fieldOf(block, 'source') === '';
    return {
      versions: lockedVersions(
        packages
          .filter(block => !isLocal(block))
          .map(block => ({ name: fieldOf(block, 'name'), version: fieldOf(block, 'version') })),
      ),
      direct: new Set(packages.filter(isLocal).flatMap(dependenciesOf)),
    };
  },
};
