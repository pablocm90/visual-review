import type { AccessReader, Action } from '../../core/access.ts';
import { NOT_SEARCHED } from './reader.ts';
import { symbolsOfRuby } from './ruby-symbols.ts';

const CONTROLLER_FILE = /(^|\/)app\/controllers\/.+\.rb$/;

const actionsIn = (file: string, text: string): ReadonlyArray<Action> => {
  const root = file.slice(0, file.indexOf('app/controllers/'));
  return symbolsOfRuby(text).symbols.flatMap(({ name, scope, kind, exported, lines }) =>
    kind === 'method' && exported && scope !== undefined && !name.startsWith('self.')
      ? [{ controller: scope, action: name, root, file, line: lines.start }]
      : [],
  );
};

export const railsAccess: AccessReader = {
  holds: path =>
    CONTROLLER_FILE.test(path) && !path.split('/').some(folder => NOT_SEARCHED.has(folder)),
  actions: ({ files }) => ({
    actions: [...files].flatMap(([file, text]) => actionsIn(file, text)),
    unread: [],
  }),
};
