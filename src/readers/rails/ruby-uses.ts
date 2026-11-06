import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Node } from 'web-tree-sitter';
import type { SymbolUse, UsesAsked, UsesReading } from '../../core/reader.ts';
import { isNoFile } from '../no-file.ts';
import { isTooBig } from '../too-big.ts';
import { classesOf, namingsIn } from './rails-graph.ts';
import { argsOf, methodOf, nameOf, parseRuby, positional } from './ruby-syntax.ts';

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

const DELEGATORS: ReadonlySet<string> = new Set(['delegate', 'def_delegator', 'def_delegators']);

const isLiteralName = ({ type, text, namedChildren }: Node): boolean =>
  LITERAL_NAMES.has(type) &&
  !text.startsWith('%') &&
  namedChildren.every(child => child.type === 'string_content');

const isOnAnother = (call: Node): boolean => {
  const receiver = call.childForFieldName('receiver');
  return receiver !== null && receiver.type !== 'self';
};

const isDelegation = (call: Node): boolean =>
  DELEGATORS.has(methodOf(call)) && call.childForFieldName('receiver') === null;

const namesInCall = (call: Node): ReadonlyArray<Node> => {
  const receiver = call.childForFieldName('receiver');
  if (isDelegation(call)) return argsOf(call).filter(isLiteralName);
  if (receiver === null || receiver.type === 'self') return [];
  const method = [call.childForFieldName('method') ?? []].flat();
  if (SENDERS.has(methodOf(call))) {
    return [...method, ...argsOf(call).slice(0, 1).filter(isLiteralName)];
  }
  return method;
};

const SETTER_END = /(?<=[\p{L}\p{N}_])=$/u;

const firstUsesIn = (program: Node): ReadonlyMap<string, Node> =>
  new Map(
    program
      .descendantsOfType(['call', 'block_argument'])
      .flatMap(node =>
        node.type === 'block_argument'
          ? node.namedChildren.filter(isLiteralName)
          : namesInCall(node),
      )
      .toSorted((one, other) => other.startIndex - one.startIndex)
      .map(named => [nameOf(named).replace(SETTER_END, ''), named]),
  );

const isOpenName = (arg: Node): boolean => arg.type !== 'block_argument' && !isLiteralName(arg);

const isOpenSend = (call: Node): boolean => {
  if (isDelegation(call)) return positional(argsOf(call)).some(isOpenName);
  const [first] = argsOf(call);
  return (
    SENDERS.has(methodOf(call)) && isOnAnother(call) && first !== undefined && isOpenName(first)
  );
};

const firstOpenSendIn = (program: Node): Node | undefined =>
  program.descendantsOfType('call').find(isOpenSend);

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
  names: ReadonlyArray<string>,
): ReadonlyMap<string, ReadonlyArray<SymbolUse>> => {
  const lines = text.split('\n');
  const rowAt = (at: Node): SymbolUse => {
    const row = at.startPosition.row;
    return { path, line: row + 1, text: (lines[row] ?? '').trim() };
  };
  const firstNamings = new Map(namings.toReversed().map(({ at, named }) => [named, at]));
  const firstUses = firstUsesIn(program);
  const open = firstOpenSendIn(program);
  const rowsOf = (name: string): ReadonlyArray<SymbolUse> => {
    const { owner, member } = askedOf(name);
    const naming = firstNamings.get(owner);
    if (naming === undefined) return [];
    if (member === undefined || member === 'initialize') return [rowAt(naming)];
    const use = firstUses.get(member);
    if (use !== undefined) return [rowAt(use)];
    return open === undefined ? [] : [{ ...rowAt(open), unfollowed: true }];
  };
  return new Map(names.map(name => [name, rowsOf(name)]));
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
  const rows = reads.flatMap(({ id, path, read }) =>
    read === undefined || 'notRead' in read
      ? []
      : [
          rowsIn(
            { path, ...read, namings: namingsIn(read.program, constantIn(id), classes) },
            names,
          ),
        ],
  );
  return {
    uses: Object.fromEntries(names.map(name => [name, rows.flatMap(row => row.get(name) ?? [])])),
    notRead: reads.flatMap(({ path, read }) =>
      read !== undefined && 'notRead' in read ? [path] : [],
    ),
    notFollowed: [NOT_DRAWN, ...(names.every(isClass) ? [] : [METHODS_NOT_FOLLOWED])],
  };
};
