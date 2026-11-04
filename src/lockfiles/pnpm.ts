import { type Lockfile, lockedVersions } from '../core/lockfile.ts';

const PACKAGE_KEY = /^ {2}(?:'([^']+)'|([^\s'"]+)):$/gm;
const DECLARATIONS =
  /^ {4}(?:dependencies|devDependencies|optionalDependencies):\n((?: {6}.*\n?)*)/gm;
const DECLARED = /^ {6}'?([^\s'":]+)'?:\n {8}specifier: .*\n {8}version: '?([^'\s]+)'?$/gm;

const PACKAGES_LINE = /^(?: {2}(?:'[^']+@[^']+'|[^\s'"]+@[^\s'"]+):| {4}.*|)$/;
const IMPORTERS_LINE =
  /^(?: {2}\S.*:(?: \{\})?| {4}(?:dependencies:|devDependencies:|optionalDependencies:|dependenciesMeta:|publishDirectory: .*)| {6}.*|)$/;

const everyLine = (section: string, shape: RegExp): boolean =>
  section.split('\n').every(line => shape.test(line));

const hasPlainHeaders = (text: string): boolean =>
  text
    .split('\n')
    .filter(line => /^(?=\S).*(?:packages|importers)/.test(line))
    .every(line => line === 'packages:' || line === 'importers:');

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

const assertVersion9 = (text: string): void => {
  const major = text.match(/^lockfileVersion: '?(\d+)/m)?.[1];
  if (major === undefined) throw new Error('format not recognised');
  if (major !== '9') throw new Error(`lockfile version ${major}`);
};

const lockedPackage = ([, quoted, plain]: RegExpExecArray) => {
  const [name, version] = splitAtVersion(quoted ?? plain ?? '');
  return { name, version };
};

const declaredNames = ([, entries = '']: RegExpExecArray): ReadonlyArray<string> =>
  [...entries.matchAll(DECLARED)].flatMap(([, name = '', version = '']) =>
    declaredName(name, version),
  );

const holdsOnlyDeclared = ([, entries = '']: RegExpExecArray): boolean =>
  entries.replaceAll(DECLARED, '').trim() === '';

export const pnpmLockfile: Lockfile = {
  file: 'pnpm-lock.yaml',
  ecosystem: 'npm',
  read: ({ text }) => {
    assertVersion9(text);
    const packagesSection = sectionOf(text, 'packages');
    const importers = sectionOf(text, 'importers');
    const declarations = [...importers.matchAll(DECLARATIONS)];
    if (
      !hasPlainHeaders(text) ||
      !everyLine(packagesSection, PACKAGES_LINE) ||
      !everyLine(importers, IMPORTERS_LINE) ||
      !declarations.every(holdsOnlyDeclared)
    )
      throw new Error('format not recognised');
    return {
      versions: lockedVersions([...packagesSection.matchAll(PACKAGE_KEY)].map(lockedPackage)),
      direct: new Set(declarations.flatMap(declaredNames)),
    };
  },
};
