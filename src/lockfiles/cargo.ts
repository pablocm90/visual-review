import { type Lockfile, lockedVersions } from '../core/lockfile.ts';

const HEADERS = new Set(['[[package]]', '[[patch.unused]]', '[metadata]']);
const PREAMBLE_LINE = /^(?:#.*|version = \d+|)$/;
const PACKAGE_LINE =
  /^(?:(?:name|version|source|checksum|replace) = "[^"]+"|dependencies = \[\]?| "[^"]+",|\]|)$/;

const fieldOf = (block: string, field: string): string =>
  block.match(new RegExp(`^${field} = "(.+)"$`, 'm'))?.[1] ?? '';

const dependenciesOf = (block: string): ReadonlyArray<string> =>
  [
    ...(block.match(/^dependencies = \[\n([^\]]*)\]/m)?.[1] ?? '').matchAll(/^ "([^" ]+)/gm),
  ].flatMap(([, name]) => name ?? []);

const isCanonical = (preamble: string, packages: ReadonlyArray<string>): boolean =>
  packages.length > 0 &&
  preamble.split('\n').every(line => PREAMBLE_LINE.test(line)) &&
  packages.every(
    block =>
      fieldOf(block, 'name') !== '' &&
      fieldOf(block, 'version') !== '' &&
      block
        .split('\n')
        .slice(1)
        .every(line => PACKAGE_LINE.test(line)),
  );

export const cargoLockfile: Lockfile = {
  file: 'Cargo.lock',
  ecosystem: 'cargo',
  read: ({ text }) => {
    const sections = text.split(/^(?=\[)/m);
    const preamble = sections.find(section => !section.startsWith('[')) ?? '';
    const packages = sections.filter(section => section.startsWith('[[package]]'));
    const headers = text.split('\n').filter(line => /^\s*\[/.test(line));
    if (!headers.every(line => HEADERS.has(line)) || !isCanonical(preamble, packages))
      throw new Error('Cargo.lock format not recognised');
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
