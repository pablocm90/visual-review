import type { Node } from 'web-tree-sitter';
import type {
  TenantConfig,
  TenantFileNotRead,
  TenantReader,
  TenantUnread,
} from '../../core/tenant.ts';
import { isTooBig, TOO_BIG } from '../too-big.ts';
import { NOT_SEARCHED } from './reader.ts';
import { argsOf, methodOf, readRuby, writtenIn } from './ruby-syntax.ts';

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

type Excluded = Pick<TenantConfig, 'excluded' | 'unread'>;

const STRINGS: ReadonlySet<string> = new Set(['string', 'bare_string']);

const CONSTANTS: ReadonlySet<string> = new Set(['constant', 'scope_resolution']);

const nameIn = (node: Node): string | undefined => {
  if (STRINGS.has(node.type) && node.namedChildren.every(({ type }) => type === 'string_content'))
    return node.namedChildren.map(({ text }) => text).join('');
  if (CONSTANTS.has(node.type) && node.descendantsOfType('identifier').length === 0)
    return node.text.replace(/^::/, '');
  return undefined;
};

const LISTS: ReadonlySet<string> = new Set(['array', 'string_array']);

const unreadAt = (file: string, node: Node): TenantUnread => ({
  text: node.text,
  file,
  line: node.startPosition.row + 1,
});

const listOf = (file: string, list: Node): Excluded => {
  if (!LISTS.has(list.type)) return { excluded: [], unread: [unreadAt(file, list)] };
  const read = writtenIn(list).map(node => ({ node, name: nameIn(node) }));
  const unread = read.flatMap(({ node, name }) =>
    name === undefined ? [unreadAt(file, node)] : [],
  );
  return {
    excluded: read.flatMap(({ name }) => (name === undefined ? [] : [name])),
    ...(unread.length === 0 ? {} : { unread }),
  };
};

const excludedIn = (file: string, configure: Node): Excluded => {
  const right = configure
    .descendantsOfType('assignment')
    .filter(assignment => {
      const left = assignment.childForFieldName('left');
      return left !== null && methodOf(left) === 'excluded_models';
    })
    .at(-1)
    ?.childForFieldName('right');
  return right == null ? { excluded: [] } : listOf(file, right);
};

const carries = (root: Node): boolean =>
  root
    .descendantsOfType('call')
    .some(
      call => methodOf(call) === 'include' && argsOf(call).some(({ text }) => CARRIER.has(text)),
    );

type HeldFile =
  | {
      readonly root: string;
      readonly configs: ReadonlyArray<Omit<TenantConfig, 'jobsCarryTenant'>>;
      readonly carries: boolean;
    }
  | TenantFileNotRead;

const heldFileOf = (file: string, text: string): HeldFile => {
  const root = HELD.exec(file)?.[1] ?? '';
  if (!text.includes('Apartment')) return { root, configs: [], carries: false };
  if (isTooBig(text)) return { root, file, reason: `${file} ${TOO_BIG}` };
  return readRuby(text, tree =>
    tree.hasError
      ? { root, file, reason: `Ruby syntax error in ${file}` }
      : {
          root,
          configs: configuresIn(tree).map(configure => ({
            root,
            file,
            ...excludedIn(file, configure),
          })),
          carries: carries(tree),
        },
  );
};

export const railsTenant: TenantReader = {
  holds: path => HELD.test(path) && !path.split('/').some(folder => NOT_SEARCHED.has(folder)),
  configs: files => {
    const read = [...files].map(([file, text]) => heldFileOf(file, text));
    const held = read.flatMap(each => ('reason' in each ? [] : [each]));
    const notRead = read.flatMap(each => ('reason' in each ? [each] : []));
    return {
      configs: held.flatMap(({ configs }) =>
        configs.map(config => ({
          ...config,
          jobsCarryTenant: held.some(other => other.root === config.root && other.carries),
        })),
      ),
      ...(notRead.length === 0 ? {} : { notRead }),
    };
  },
};
