import type { Node } from 'web-tree-sitter';
import type { TenantConfig, TenantReader } from '../../core/tenant.ts';
import { methodOf, namesIn, readRuby } from './ruby-syntax.ts';

const CONFIG_FILE = /(^|\/)config\/.+\.rb$/;

const excludedIn = (root: Node): ReadonlyArray<string> =>
  root
    .descendantsOfType('assignment')
    .filter(assignment => {
      const left = assignment.childForFieldName('left');
      return left?.type === 'call' && methodOf(left) === 'excluded_models';
    })
    .flatMap(assignment => namesIn(assignment.childForFieldName('right') ?? undefined));

const configOf = (file: string, text: string): TenantConfig => ({
  root: file.slice(0, file.indexOf('config/')),
  file,
  excluded: readRuby(text, excludedIn),
  jobsCarryTenant: false,
});

export const railsTenant: TenantReader = {
  holds: path => CONFIG_FILE.test(path),
  configs: files => ({ configs: [...files].map(([file, text]) => configOf(file, text)) }),
};
