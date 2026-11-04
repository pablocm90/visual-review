import { type Lockfile, lockedVersions } from '../core/lockfile.ts';

const KEYS = '(?:"[^"\\n]+"|[^\\s",:#]+)';
const BLOCK = new RegExp(`^(${KEYS}(?:, ${KEYS})*):\\n {2}version "?([^"\\s]+)"?$`, 'gm');
const KEY = /"([^"]+)"|([^\s",]+)/g;
const ALIAS = /^npm:((?:@[^/]+\/)?[^@]+)/;

const realNames = (pattern: string): ReadonlyArray<string> => {
  const at = pattern.indexOf('@', 1);
  const range = pattern.slice(at + 1);
  if (/^(?:file|link):/.test(range)) return [];
  return [range.match(ALIAS)?.[1] ?? pattern.slice(0, at)];
};

export const yarnLockfile: Lockfile = {
  file: 'yarn.lock',
  ecosystem: 'npm',
  read: ({ text }) => {
    if (/^__metadata:$/m.test(text)) throw new Error('yarn.lock Yarn 2+ format');
    if (!/^# yarn lockfile v1$/m.test(text)) throw new Error('yarn.lock format not recognised');
    return {
      versions: lockedVersions(
        [...text.matchAll(BLOCK)].flatMap(([, keys = '', version = '']) =>
          [...keys.matchAll(KEY)]
            .flatMap(([, quoted, plain]) => realNames(quoted ?? plain ?? ''))
            .map(name => ({ name, version })),
        ),
      ),
      direct: new Set(),
    };
  },
};
