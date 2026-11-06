import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Node } from 'web-tree-sitter';
import type { GraphNode } from '../../core/graph.ts';
import type { SymbolUse, UsesAsked, UsesReading } from '../../core/reader.ts';
import { classesOf, namingsIn } from './rails-graph.ts';
import { argsOf, methodOf, nameOf, parseRuby } from './ruby-syntax.ts';

const CLASS = '/class/';

const constantIn = (id: string): string => id.slice(id.lastIndexOf(CLASS) + CLASS.length);

const STARTS_AS_CONSTANT = /^\p{Lu}/u;

const askedOf = (name: string) => {
  const [owner = '', ...rest] = name.split('.');
  return { owner, member: rest.at(-1) };
};

const LITERAL_NAMES: ReadonlySet<string> = new Set(['simple_symbol', 'delimited_symbol', 'string']);

const SENDERS: ReadonlySet<string> = new Set(['send', 'public_send', '__send__', 'try']);

const isLiteralName = ({ type }: Node): boolean => LITERAL_NAMES.has(type);

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

export const usesOfRuby = async ({ head, graph, node, names }: UsesAsked): Promise<UsesReading> => {
  const stack = node.id.slice(0, node.id.lastIndexOf(CLASS) + CLASS.length);
  const classes = classesOf([
    ...graph.nodes.filter(({ id }) => id.startsWith(stack)).map(({ id }) => constantIn(id)),
    ...names.map(name => askedOf(name).owner).filter(owner => STARTS_AS_CONSTANT.test(owner)),
  ]);
  const importers = graph.edges
    .filter(({ to }) => to === node.id)
    .flatMap(({ from }) => graph.nodes.find(({ id }) => id === from) ?? []);
  const rowsOf = async (
    { id, path }: GraphNode,
    name: string,
  ): Promise<ReadonlyArray<SymbolUse>> => {
    const { owner, member } = askedOf(name);
    const text = await readFile(join(head, path), 'utf8');
    const program = parseRuby(text);
    const naming = namingsIn(program, constantIn(id), classes).find(({ named }) => named === owner);
    if (naming === undefined) return [];
    const at =
      member === undefined || member === 'initialize' ? naming.at : firstUseIn(program, member);
    if (at === undefined) return [];
    const row = at.startPosition.row;
    return [{ path, line: row + 1, text: (text.split('\n')[row] ?? '').trim() }];
  };
  const entries = await Promise.all(
    names.map(async name => [
      name,
      (await Promise.all(importers.map(importer => rowsOf(importer, name)))).flat(),
    ]),
  );
  return { uses: Object.fromEntries(entries), notRead: [], notFollowed: [] };
};
