import { type Lockfile, lockedVersions } from '../core/lockfile.ts';

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
const ALIAS = /^npm:((?:@[^/]+\/)?[^@]+)/;

const realNames = (pattern: string): ReadonlyArray<string> => {
  const at = pattern.indexOf('@', 1);
  if (at === -1) throw new Error(NOT_RECOGNISED);
  const range = pattern.slice(at + 1);
  if (/^(?:file|link):/.test(range)) return [];
  return [range.match(ALIAS)?.[1] ?? pattern.slice(0, at)];
};

export const yarnLockfile: Lockfile = {
  file: 'yarn.lock',
  ecosystem: 'npm',
  read: ({ text }) => {
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
      direct: new Set(),
    };
  },
};
