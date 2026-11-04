import { type Lockfile, lockedVersions } from '../core/lockfile.ts';
import { aliasOf, declarationsOf, Manifest } from './npm-manifest.ts';

const KEYS = '(?:"[^"\\n]+"|[^\\s",:#]+)';
const BLOCK = new RegExp(`^(${KEYS}(?:, ${KEYS})*):\\n {2}version "?([^"\\s]+)"?$`, 'gm');
const KEY = /"([^"]+)"|([^\s",]+)/g;
const HEADER = new RegExp(`^${KEYS}(?:, ${KEYS})*:$`);
const VERSION = /^ {2}version "?[^"\s]+"?$/;
const KNOWN_LINE = new RegExp(
  [
    '^$',
    '^# .*$',
    HEADER.source,
    VERSION.source,
    '^ {2}(resolved|integrity|uid|registry) \\S.*$',
    '^ {2}(dependencies|optionalDependencies):$',
    `^ {4}${KEYS} \\S.*$`,
  ].join('|'),
);
const NOT_RECOGNISED = 'yarn.lock format not recognised';
const LOCAL_SPEC = /^(?:file|link):/;

const realNames = (pattern: string): ReadonlyArray<string> => {
  const at = pattern.indexOf('@', 1);
  if (at === -1) throw new Error(NOT_RECOGNISED);
  const range = pattern.slice(at + 1);
  if (LOCAL_SPEC.test(range)) return [];
  return [aliasOf(range) ?? pattern.slice(0, at)];
};

const declaredIn = (manifest: string): ReadonlyArray<string> => {
  try {
    return declarationsOf(Manifest.parse(JSON.parse(manifest))).flatMap(([name, spec]) =>
      LOCAL_SPEC.test(spec) ? [] : [aliasOf(spec) ?? name],
    );
  } catch {
    throw new Error('yarn.lock package.json not recognised');
  }
};

export const yarnLockfile: Lockfile = {
  file: 'yarn.lock',
  ecosystem: 'npm',
  manifest: 'package.json',
  read: ({ text, manifests }) => {
    if (/^__metadata:$/m.test(text)) throw new Error('yarn.lock Yarn 2+ format');
    if (!/^# yarn lockfile v1$/m.test(text)) throw new Error(NOT_RECOGNISED);
    const lines = text.split('\n');
    const blocks = [...text.matchAll(BLOCK)];
    if (
      !lines.every(line => KNOWN_LINE.test(line)) ||
      lines.filter(line => HEADER.test(line)).length !== blocks.length ||
      lines.filter(line => VERSION.test(line)).length !== blocks.length
    )
      throw new Error(NOT_RECOGNISED);
    return {
      versions: lockedVersions(
        blocks.flatMap(([, keys = '', version = '']) =>
          [...keys.matchAll(KEY)]
            .flatMap(([, quoted, plain]) => realNames(quoted ?? plain ?? ''))
            .map(name => ({ name, version })),
        ),
      ),
      direct: new Set(manifests.flatMap(declaredIn)),
    };
  },
};
