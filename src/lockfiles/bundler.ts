import { type Lockfile, lockedVersions } from '../core/lockfile.ts';

const REMOTE_SOURCE = /^(?:GEM|GIT|PLUGIN SOURCE)\n/;
const LOCKED_GEM = /^ {4}(\S+) \(([^)-]+)/gm;
const DEPENDENCY = /^ {2}[^\s!]+/gm;

export const bundlerLockfile: Lockfile = {
  file: 'Gemfile.lock',
  ecosystem: 'bundler',
  read: ({ text }) => {
    const sections = text.split(/^(?=[A-Z])/m);
    const dependencies = sections.filter(section => section.startsWith('DEPENDENCIES\n'));
    if (dependencies.length === 0) throw new Error('format not recognised');
    return {
      versions: lockedVersions(
        sections
          .filter(section => REMOTE_SOURCE.test(section))
          .flatMap(section => [...section.matchAll(LOCKED_GEM)])
          .map(([, name = '', version = '']) => ({ name, version })),
      ),
      direct: new Set(
        dependencies.flatMap(section => section.match(DEPENDENCY) ?? []).map(name => name.trim()),
      ),
    };
  },
};
