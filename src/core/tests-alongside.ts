import { deepestHolding, isAtOrUnder } from './diff-graphs.ts';
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

type NodeOfTestsOptions = {
  readonly nodes: ReadonlyArray<Pick<GraphNode, 'id' | 'parent' | 'path'>>;
  readonly file: Pick<TestFile, 'path' | 'stack'>;
};

export const nodeOfTests = ({ nodes, file }: NodeOfTestsOptions): string | undefined => {
  const holder = deepestHolding(file.path, nodes);
  const stackOf = stackOfIn(nodes);
  const named = nodes.find(
    each =>
      stem(each.path) === testedStem(file.path) &&
      stackOf(each.id) === file.stack &&
      (holder === undefined || isAtOrUnder(each.path, holder)),
  );
  return (named ?? holder ?? nodes.find(({ id }) => id === file.stack))?.id;
};

type SubjectsOptions = {
  readonly parts: ReadonlyArray<string>;
  readonly cycles: ReadonlyArray<ReadonlyArray<string>>;
  readonly nodes: ReadonlyArray<GraphNode>;
  readonly tests: ReadonlyArray<Pick<TestFile, 'path' | 'stack'>>;
};

/**
 * Each test file among the parts with the part it tests, named alike in its stack, when both are
 * parts outside every cycle: the reading order reads a test right after its subject.
 */
export const subjectsOfTests = ({
  parts,
  cycles,
  nodes,
  tests,
}: SubjectsOptions): ReadonlyMap<string, string> => {
  const inCycle = new Set(cycles.flat());
  const free = new Set(parts.filter(part => !inCycle.has(part)));
  const stackOf = stackOfIn(nodes);
  const nodeOf = new Map(nodes.map(node => [node.id, node]));
  return new Map(
    [...free].flatMap(part => {
      const path = nodeOf.get(part)?.path;
      const test = tests.find(file => file.path === path);
      if (test === undefined) return [];
      const subject = [...free].find(other => {
        const node = nodeOf.get(other);
        return (
          other !== part &&
          node !== undefined &&
          node.kind === 'file' &&
          stem(node.path) === testedStem(test.path) &&
          stackOf(other) === test.stack
        );
      });
      return subject === undefined ? [] : [[part, subject] as const];
    }),
  );
};

/** The reading order with each test file moved to just after the part it tests. */
export const testsAfterSubjects = (options: SubjectsOptions): ReadonlyArray<string> => {
  const subjects = subjectsOfTests(options);
  return options.parts
    .filter(part => !subjects.has(part))
    .flatMap(part => [part, ...options.parts.filter(test => subjects.get(test) === part)]);
};
