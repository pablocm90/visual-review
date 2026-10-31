import { isAtOrUnder } from './diff-graphs.ts';
import type { GraphNode } from './graph.ts';
import type { TestFile } from './test-changes.ts';

const holds = (node: GraphNode, path: string): boolean =>
  node.path === '' || isAtOrUnder(path, node);

const stem = (path: string): string =>
  path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]*$/, '');

const testedStem = (path: string): string => stem(path).replace(/[._](test|spec)$/, '');

export const deepestStackHolding = (
  nodes: ReadonlyArray<GraphNode>,
  path: string,
): GraphNode | undefined =>
  nodes
    .filter(node => node.kind === 'stack' && holds(node, path))
    .reduce<GraphNode | undefined>(
      (deepest, stack) =>
        deepest === undefined || stack.path.length > deepest.path.length ? stack : deepest,
      undefined,
    );

type TestsAlongsideOptions = {
  readonly nodes: ReadonlyArray<GraphNode>;
  readonly node: GraphNode;
  readonly tests: ReadonlyArray<TestFile>;
};

export const testsAlongside = ({
  nodes,
  node,
  tests,
}: TestsAlongsideOptions): ReadonlyArray<TestFile> => {
  const inside = nodes.filter(each => holds(node, each.path));
  return tests.filter(
    ({ path }) =>
      holds(node, path) ||
      inside.some(
        each =>
          stem(each.path) === testedStem(path) &&
          deepestStackHolding(nodes, each.path) === deepestStackHolding(nodes, path),
      ),
  );
};
