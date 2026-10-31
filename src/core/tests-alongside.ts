import { isAtOrUnder } from './diff-graphs.ts';
import { type GraphNode, stackOfIn } from './graph.ts';
import type { TestFile } from './test-changes.ts';

const stem = (path: string): string =>
  path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]*$/, '');

const testedStem = (path: string): string => stem(path).replace(/[._](test|spec)$/, '');

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
