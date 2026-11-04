import { type Lockfile, lockedVersions } from '../core/lockfile.ts';

const NOT_RECOGNISED = 'format not recognised';
const REMOTE_SOURCE = /^(?:GEM|GIT|PLUGIN SOURCE)\n/;
const SPEC_LINE = /^ {4}(?! ).*$/gm;
const LOCKED_GEM = /^ {4}(\S+) \(([^)-]+)(?:-[^)]+)?\)$/;
const DEPENDENCY = /^ {2}[^\s!]+/gm;

const lockedGem = (line: string) => {
  const [, name, version] = line.match(LOCKED_GEM) ?? [];
  if (name === undefined || version === undefined) throw new Error(NOT_RECOGNISED);
  return { name, version };
};

export const bundlerLockfile: Lockfile = {
  file: 'Gemfile.lock',
  ecosystem: 'bundler',
  read: ({ text }) => {
    const sections = text.split(/^(?=[A-Z])/m);
    const dependencies = sections.filter(section => section.startsWith('DEPENDENCIES\n'));
    if (dependencies.length === 0) throw new Error(NOT_RECOGNISED);
    return {
      versions: lockedVersions(
        sections
          .filter(section => REMOTE_SOURCE.test(section))
          .flatMap(section => section.match(SPEC_LINE) ?? [])
          .map(lockedGem),
      ),
      direct: new Set(
        dependencies.flatMap(section => section.match(DEPENDENCY) ?? []).map(name => name.trim()),
      ),
    };
  },
};
