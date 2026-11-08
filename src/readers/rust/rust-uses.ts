import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Node } from 'web-tree-sitter';
import type { SymbolUse, UsesAsked, UsesReading } from '../../core/reader.ts';
import { parseRust } from './rust-syntax.ts';

const importedNames = (root: Node): ReadonlySet<string> =>
  new Set(
    root
      .descendantsOfType('use_declaration')
      .map(declaration => declaration.childForFieldName('argument')?.text.split('::').at(-1) ?? ''),
  );

const isInUse = (node: Node): boolean =>
  node.parent !== null && (node.parent.type === 'use_declaration' || isInUse(node.parent));

const rowsIn = (
  path: string,
  text: string,
  names: ReadonlyArray<string>,
): ReadonlyMap<string, ReadonlyArray<SymbolUse>> => {
  const root = parseRust(text);
  if (root === undefined) return new Map();
  try {
    const imported = importedNames(root);
    const lines = text.split('\n');
    const identifiers = root.descendantsOfType('identifier').filter(node => !isInUse(node));
    return new Map(
      names.map(name => {
        const first = identifiers.find(node => node.text === name);
        if (!imported.has(name) || first === undefined) return [name, []];
        const row = first.startPosition.row;
        return [name, [{ path, line: row + 1, text: (lines[row] ?? '').trim() }]];
      }),
    );
  } finally {
    root.tree.delete();
  }
};

export const usesOfRust = async ({ head, graph, node, names }: UsesAsked): Promise<UsesReading> => {
  const files = graph.edges
    .filter(({ to }) => to === node.id)
    .flatMap(({ from }) => graph.nodes.find(({ id }) => id === from) ?? [])
    .map(({ path }) => rowsIn(path, readFileSync(join(head, path), 'utf8'), names));
  return {
    uses: Object.fromEntries(
      names.map(name => [name, files.flatMap(rows => rows.get(name) ?? [])]),
    ),
    notRead: [],
    notFollowed: [],
  };
};
