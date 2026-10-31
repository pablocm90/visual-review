import { isAtOrUnder } from './diff-graphs.ts';
import { type GraphNode, stackOfIn } from './graph.ts';
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
  if (node.kind === 'stack') return tests.filter(({ stack }) => stack === node.id);
  const stackOf = stackOfIn(nodes);
  const inside = nodes.filter(each => isAtOrUnder(each.path, node));
  return tests.filter(
    ({ path, stack }) =>
      isAtOrUnder(path, node) ||
      inside.some(each => stem(each.path) === testedStem(path) && stackOf(each.id) === stack),
  );
};
