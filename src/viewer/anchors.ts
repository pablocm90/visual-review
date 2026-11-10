import { fileOfLine, split } from '../core/anchors.ts';
import { endsOfId, type GraphNode } from '../core/graph.ts';
import { lineIdOf } from '../core/patch-lines.ts';
import type { PreviousComment } from '../core/previous-comments.ts';
import type { Comment } from '../core/review.ts';
import type { PatchLine } from './highlight-patch.ts';

type Anchor = Comment['anchor'];

type Nodes = ReadonlyArray<Pick<GraphNode, 'id' | 'label' | 'parent' | 'path'>>;

export const lineAnchor = ({
  path,
  line,
}: {
  readonly path: string;
  readonly line: PatchLine;
}): Anchor | undefined => {
  const id = lineIdOf(path, line);
  if (id === undefined) return undefined;
  return { kind: 'line', id, text: line.pieces.map(({ text }) => text).join('') };
};

const lineNumber = (id: string): string => id.slice(id.lastIndexOf(':') + 1);

export const lineAt = (id: string) => {
  const path = fileOfLine(id);
  const side: 'base' | 'head' = id.startsWith('@base:', path.length) ? 'base' : 'head';
  return { path, side, line: Number(lineNumber(id)) };
};

export const placeOfLine = (anchor: PreviousComment['anchor']) =>
  anchor.kind === 'line' ? { ...lineAt(anchor.id), text: anchor.text } : undefined;

export type PlaceOfLine = NonNullable<ReturnType<typeof placeOfLine>>;

export const rowOfLine = (
  lines: ReadonlyArray<PatchLine>,
  { path, side, line, text }: PlaceOfLine,
): number | undefined => {
  const rows = lines.flatMap((row, index) => {
    const anchor = lineAnchor({ path, line: row });
    const place = anchor && placeOfLine(anchor);
    return place?.side === side && place.text === text
      ? [{ index, away: Math.abs(place.line - line) }]
      : [];
  });
  return rows.reduce<(typeof rows)[number] | undefined>(
    (nearest, row) => (nearest === undefined || row.away < nearest.away ? row : nearest),
    undefined,
  )?.index;
};

export const anchorName = (anchor: Anchor, nodes: Nodes): string => {
  const labelOf = (id: string) => nodes.find(node => node.id === id)?.label ?? id;
  if (anchor.kind === 'symbol') {
    const [file, symbol] = split(anchor.id, '#');
    return `${symbol} in ${labelOf(file)}`;
  }
  if (anchor.kind === 'decision') return anchor.text;
  if (anchor.kind === 'test') return split(anchor.id, '#')[1].split(' › ').at(-1) ?? anchor.id;
  if (anchor.kind === 'line') {
    const file = fileOfLine(anchor.id);
    const label = nodes.find(node => node.path === file)?.label ?? file;
    return `${label}:${lineNumber(anchor.id)} "${anchor.text.trim()}"`;
  }
  return endsOfId(anchor.id).map(labelOf).join(' → ');
};
