import type { Node } from 'web-tree-sitter';
import type { TenantConfig, TenantReader } from '../../core/tenant.ts';
import { methodOf, namesIn, readRuby } from './ruby-syntax.ts';

const CONFIG_FILE = /(^|\/)config\/.+\.rb$/;

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

const configsOf = (file: string, text: string): ReadonlyArray<TenantConfig> =>
  text.includes('Apartment')
    ? readRuby(text, root =>
        configuresIn(root).map(configure => ({
          root: file.slice(0, file.indexOf('config/')),
          file,
          excluded: excludedIn(configure),
          jobsCarryTenant: false,
        })),
      )
    : [];

export const railsTenant: TenantReader = {
  holds: path => CONFIG_FILE.test(path),
  configs: files => ({ configs: [...files].flatMap(([file, text]) => configsOf(file, text)) }),
};
