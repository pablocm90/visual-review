import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Node } from 'web-tree-sitter';
import type { SymbolUse, UsesAsked, UsesReading } from '../../core/reader.ts';
import { isNoFile } from '../no-file.ts';
import { isTooBig } from '../too-big.ts';
import { classesOf, namingsIn } from './rails-graph.ts';
import { argsOf, methodOf, nameOf, parseRuby } from './ruby-syntax.ts';

export const NOT_DRAWN =
  'not followed: views, tests and other files outside `app/` and `lib/`, and a base class the graph draws no edge into, such as `ApplicationRecord`';

export const METHODS_NOT_FOLLOWED =
  'not followed: a method called with no receiver, through a subclass, in a file not naming its class, by `try!`, `method(:x)` or as an operator, or with no class around it';

const CLASS = '/class/';

const constantIn = (id: string): string => id.slice(id.lastIndexOf(CLASS) + CLASS.length);

const STARTS_AS_CONSTANT = /^\p{Lu}/u;

const askedOf = (name: string) => {
  const [owner = '', ...rest] = name.split('.');
  return { owner, member: rest.at(-1) };
};

const isClass = (name: string): boolean => {
  const { owner, member } = askedOf(name);
  return member === undefined && STARTS_AS_CONSTANT.test(owner);
};

const LITERAL_NAMES: ReadonlySet<string> = new Set(['simple_symbol', 'delimited_symbol', 'string']);

const SENDERS: ReadonlySet<string> = new Set(['send', 'public_send', '__send__', 'try']);

const isLiteralName = ({ type, namedChildren }: Node): boolean =>
  LITERAL_NAMES.has(type) && !namedChildren.some(child => child.type === 'interpolation');

const isOnAnother = (call: Node): boolean => {
  const receiver = call.childForFieldName('receiver');
  return receiver !== null && receiver.type !== 'self';
};

const namesInCall = (call: Node): ReadonlyArray<Node> => {
  const receiver = call.childForFieldName('receiver');
  if (methodOf(call) === 'delegate' && receiver === null) return argsOf(call).filter(isLiteralName);
  if (receiver === null || receiver.type === 'self') return [];
  if (SENDERS.has(methodOf(call))) return argsOf(call).slice(0, 1).filter(isLiteralName);
  return [call.childForFieldName('method') ?? []].flat();
};

const firstUseIn = (program: Node | undefined, member: string): Node | undefined =>
  program
    ?.descendantsOfType(['call', 'block_argument'])
    .flatMap(node =>
      node.type === 'block_argument' ? node.namedChildren.filter(isLiteralName) : namesInCall(node),
    )
    .find(named => nameOf(named) === member);

const firstOpenSendIn = (program: Node | undefined): Node | undefined =>
  program?.descendantsOfType('call').find(call => {
    const [first] = argsOf(call);
    return (
      SENDERS.has(methodOf(call)) &&
      isOnAnother(call) &&
      first !== undefined &&
      first.type !== 'block_argument' &&
      !isLiteralName(first)
    );
  });

type Read = { readonly text: string; readonly program: Node } | { readonly notRead: true };

const NOT_READ: Read = { notRead: true };

const readRuby = (file: string): Read | undefined => {
  try {
    const text = readFileSync(file, 'utf8');
    if (isTooBig(text)) return NOT_READ;
    const program = parseRuby(text);
    return program === undefined || program.hasError ? NOT_READ : { text, program };
  } catch (error) {
    return isNoFile(error) ? undefined : NOT_READ;
  }
};

type Importer = {
  readonly path: string;
  readonly text: string;
  readonly program: Node;
  readonly namings: ReadonlyArray<{ readonly at: Node; readonly named: string }>;
};

const rowsIn = (
  { path, text, program, namings }: Importer,
  name: string,
): ReadonlyArray<SymbolUse> => {
  const { owner, member } = askedOf(name);
  const naming = namings.find(({ named }) => named === owner);
  if (naming === undefined) return [];
  const rowAt = (at: Node): SymbolUse => {
    const row = at.startPosition.row;
    return { path, line: row + 1, text: (text.split('\n')[row] ?? '').trim() };
  };
  if (member === undefined || member === 'initialize') return [rowAt(naming.at)];
  const use = firstUseIn(program, member);
  if (use !== undefined) return [rowAt(use)];
  const open = firstOpenSendIn(program);
  return open === undefined ? [] : [{ ...rowAt(open), unfollowed: true }];
};

export const usesOfRuby = async ({ head, graph, node, names }: UsesAsked): Promise<UsesReading> => {
  const stack = node.id.slice(0, node.id.lastIndexOf(CLASS) + CLASS.length);
  const classes = classesOf([
    ...graph.nodes.filter(({ id }) => id.startsWith(stack)).map(({ id }) => constantIn(id)),
    ...names.map(name => askedOf(name).owner).filter(owner => STARTS_AS_CONSTANT.test(owner)),
  ]);
  const reads = graph.edges
    .filter(({ to }) => to === node.id)
    .flatMap(({ from }) => graph.nodes.find(({ id }) => id === from) ?? [])
    .map(({ id, path }) => ({ id, path, read: readRuby(join(head, path)) }));
  const importers = reads.flatMap(({ id, path, read }) =>
    read === undefined || 'notRead' in read
      ? []
      : [{ path, ...read, namings: namingsIn(read.program, constantIn(id), classes) }],
  );
  return {
    uses: Object.fromEntries(
      names.map(name => [name, importers.flatMap(importer => rowsIn(importer, name))]),
    ),
    notRead: reads.flatMap(({ path, read }) =>
      read !== undefined && 'notRead' in read ? [path] : [],
    ),
    notFollowed: [NOT_DRAWN, ...(names.every(isClass) ? [] : [METHODS_NOT_FOLLOWED])],
  };
};
