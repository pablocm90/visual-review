import { deepestHolding } from '../core/diff-graphs.ts';
import { endsOfId, type GraphNode } from '../core/graph.ts';
import type { Comment } from '../core/review.ts';
import type { TestFile } from '../core/test-changes.ts';
import { nodeOfTests } from '../core/tests-alongside.ts';
import type { PatchLine } from './highlight-patch.ts';

type Anchor = Comment['anchor'];

type Nodes = ReadonlyArray<Pick<GraphNode, 'id' | 'label' | 'parent' | 'path'>>;

export const lineAnchor = ({
  path,
  line: { kind, pieces, ...numbers },
}: {
  readonly path: string;
  readonly line: PatchLine;
}): Anchor | undefined => {
  const side = kind === 'removed' ? 'base' : 'head';
  const number = numbers[side];
  if (number === undefined) return undefined;
  return {
    kind: 'line',
    id: `${path}@${side}:${number}`,
    text: pieces.map(({ text }) => text).join(''),
  };
};

export const anchorKey = ({ kind, id }: Pick<Anchor, 'kind' | 'id'>): string => `${kind} ${id}`;

const split = (id: string, at: string): readonly [string, string] => {
  const cut = id.indexOf(at);
  return [id.slice(0, cut), id.slice(cut + at.length)];
};

const fileOfLine = (id: string): string => id.slice(0, id.lastIndexOf('@'));

const lineNumber = (id: string): string => id.slice(id.lastIndexOf(':') + 1);

export type TargetsOf = {
  readonly nodes: Nodes;
  readonly tests: ReadonlyArray<Pick<TestFile, 'path' | 'stack'>>;
};

export const anchorTarget = (anchor: Anchor, { nodes, tests }: TargetsOf): string | undefined => {
  if (anchor.kind === 'symbol' || anchor.kind === 'decision') return split(anchor.id, '#')[0];
  if (anchor.kind === 'line') return deepestHolding(fileOfLine(anchor.id), nodes)?.id;
  if (anchor.kind !== 'test') return anchor.id;
  const file = tests.find(({ path }) => path === split(anchor.id, '#')[0]);
  return file && nodeOfTests({ nodes, file });
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
    return `${label}:${lineNumber(anchor.id)} "${anchor.text}"`;
  }
  return endsOfId(anchor.id).map(labelOf).join(' → ');
};
