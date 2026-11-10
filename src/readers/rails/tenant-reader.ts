import type { Node } from 'web-tree-sitter';
import type { TenantConfig, TenantReader } from '../../core/tenant.ts';
import { NOT_SEARCHED } from './reader.ts';
import { argsOf, methodOf, namesIn, readRuby } from './ruby-syntax.ts';

const HELD = /^(.*?)(?<=^|\/)(config\/.+|app\/jobs\/application_job)\.rb$/;

const CARRIER: ReadonlySet<string> = new Set(['Apartment::ActiveJob', '::Apartment::ActiveJob']);

const APARTMENT: ReadonlySet<string> = new Set(['Apartment', '::Apartment']);

const configuresIn = (root: Node): ReadonlyArray<Node> =>
  root
    .descendantsOfType('call')
    .filter(
      call =>
        methodOf(call) === 'configure' &&
        APARTMENT.has(call.childForFieldName('receiver')?.text ?? ''),
    );

const excludedIn = (configure: Node): ReadonlyArray<string> =>
  configure
    .descendantsOfType('assignment')
    .filter(assignment => {
      const left = assignment.childForFieldName('left');
      return left?.type === 'call' && methodOf(left) === 'excluded_models';
    })
    .flatMap(assignment => namesIn(assignment.childForFieldName('right') ?? undefined));

const carries = (root: Node): boolean =>
  root
    .descendantsOfType('call')
    .some(
      call => methodOf(call) === 'include' && argsOf(call).some(({ text }) => CARRIER.has(text)),
    );

type HeldFile = {
  readonly root: string;
  readonly configs: ReadonlyArray<Omit<TenantConfig, 'jobsCarryTenant'>>;
  readonly carries: boolean;
};

const heldFileOf = (file: string, text: string): HeldFile => {
  const root = HELD.exec(file)?.[1] ?? '';
  if (!text.includes('Apartment')) return { root, configs: [], carries: false };
  return readRuby(text, tree => ({
    root,
    configs: configuresIn(tree).map(configure => ({ root, file, excluded: excludedIn(configure) })),
    carries: carries(tree),
  }));
};

export const railsTenant: TenantReader = {
  holds: path => HELD.test(path) && !path.split('/').some(folder => NOT_SEARCHED.has(folder)),
  configs: files => {
    const held = [...files].map(([file, text]) => heldFileOf(file, text));
    return {
      configs: held.flatMap(({ configs }) =>
        configs.map(config => ({
          ...config,
          jobsCarryTenant: held.some(other => other.root === config.root && other.carries),
        })),
      ),
    };
  },
};
