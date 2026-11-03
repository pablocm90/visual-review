import { isAtOrUnder } from '../core/diff-graphs.ts';
import { endsOfId, type GraphNode } from '../core/graph.ts';
import type { Comment } from '../core/review.ts';

type Anchor = Comment['anchor'];

type Nodes = ReadonlyArray<Pick<GraphNode, 'id' | 'label' | 'path'>>;

export const anchorKey = ({ kind, id }: Pick<Anchor, 'kind' | 'id'>): string => `${kind} ${id}`;

const split = (id: string, at: string): readonly [string, string] => {
  const cut = id.indexOf(at);
  return [id.slice(0, cut), id.slice(cut + at.length)];
};

const fileOfLine = (id: string): string => id.slice(0, id.lastIndexOf('@'));

const lineNumber = (id: string): string => id.slice(id.lastIndexOf(':') + 1);

const deepestHolding = (path: string, nodes: Nodes) =>
  nodes
    .filter(node => isAtOrUnder(path, node))
    .toSorted((one, other) => other.path.length - one.path.length)[0];

const pathOf = (anchor: Anchor): string | undefined => {
  if (anchor.kind === 'test') return split(anchor.id, '#')[0];
  if (anchor.kind === 'line') return fileOfLine(anchor.id);
  return undefined;
};

export const anchorTarget = (anchor: Anchor, nodes: Nodes): string | undefined => {
  if (anchor.kind === 'symbol' || anchor.kind === 'decision') return split(anchor.id, '#')[0];
  const path = pathOf(anchor);
  return path === undefined ? anchor.id : deepestHolding(path, nodes)?.id;
};

export const anchorName = (anchor: Anchor, nodes: Nodes): string => {
  const labelOf = (id: string) => nodes.find(node => node.id === id)?.label ?? id;
  if (anchor.kind === 'symbol') {
    const [file, symbol] = split(anchor.id, '#');
    return `${symbol} in ${labelOf(file)}`;
  }
  if (anchor.kind === 'decision') return split(split(anchor.id, '#')[1], '#')[1];
  if (anchor.kind === 'test') return split(anchor.id, '#')[1].split(' › ').at(-1) ?? anchor.id;
  if (anchor.kind === 'line') {
    const file = fileOfLine(anchor.id);
    const label = nodes.find(node => node.path === file)?.label ?? file;
    return `${label}:${lineNumber(anchor.id)} "${anchor.text}"`;
  }
  return endsOfId(anchor.id).map(labelOf).join(' → ');
};
