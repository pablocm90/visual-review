import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GraphNode } from '../../core/graph.ts';
import type { SymbolUse, UsesAsked, UsesReading } from '../../core/reader.ts';
import { classesOf, namingsIn } from './rails-graph.ts';
import { parseRuby } from './ruby-syntax.ts';

const CLASS = '/class/';

const constantIn = (id: string): string => id.slice(id.lastIndexOf(CLASS) + CLASS.length);

export const usesOfRuby = async ({ head, graph, node, names }: UsesAsked): Promise<UsesReading> => {
  const stack = node.id.slice(0, node.id.lastIndexOf(CLASS) + CLASS.length);
  const classes = classesOf([
    ...graph.nodes.filter(({ id }) => id.startsWith(stack)).map(({ id }) => constantIn(id)),
    ...names,
  ]);
  const importers = graph.edges
    .filter(({ to }) => to === node.id)
    .flatMap(({ from }) => graph.nodes.find(({ id }) => id === from) ?? []);
  const rowsOf = async (
    { id, path }: GraphNode,
    name: string,
  ): Promise<ReadonlyArray<SymbolUse>> => {
    const text = await readFile(join(head, path), 'utf8');
    const first = namingsIn(parseRuby(text), constantIn(id), classes).find(
      ({ named }) => named === name,
    );
    if (first === undefined) return [];
    const row = first.at.startPosition.row;
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
