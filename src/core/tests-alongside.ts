import { deepestHolding, isAtOrUnder } from './diff-graphs.ts';
import { type GraphNode, stackOfIn } from './graph.ts';
import { anyChanged, type TestFile } from './test-changes.ts';

const folderOf = (path: string): string => path.slice(0, path.lastIndexOf('/') + 1);

const stem = (path: string): string =>
  path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]*$/, '');

const testedStem = (path: string): string => stem(path).replace(/[._](test|spec)$/, '');

/** A node as the naming reads it; one passed without its kind is taken for no package. */
type Placed = Pick<GraphNode, 'id' | 'parent' | 'path'> & { readonly kind?: GraphNode['kind'] };

/** The package holding a path, such as a Rust crate, if any. */
const packageHolding = (nodes: ReadonlyArray<Placed>) => (path: string) =>
  deepestHolding(
    path,
    nodes.filter(({ kind }) => kind === 'package'),
  )?.id;

/**
 * Whether a node is the one a test file is named after (`refund.ts`, `refund.test.ts`) in its stack,
 * and in its package when a package holds the test: a crate's `tests/hops.rs` isn't another crate's.
 */
const namedAlike = (nodes: ReadonlyArray<Placed>) => {
  const stackOf = stackOfIn(nodes);
  const packageOf = packageHolding(nodes);
  return (
    node: Pick<GraphNode, 'id' | 'path'>,
    test: Pick<TestFile, 'path' | 'stack'>,
  ): boolean => {
    if (stem(node.path) !== testedStem(test.path) || stackOf(node.id) !== test.stack) return false;
    const held = packageOf(test.path);
    return held === undefined || packageOf(node.path) === held;
  };
};

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
  const alike = namedAlike(nodes);
  const inside = nodes.filter(each => isAtOrUnder(each.path, node));
  /**
   * A test named after no node tests what sits beside it: the files in its folder, or, held by a
   * package such as a Rust crate's `tests/` file, the package whole.
   */
  const testsWhatIsBeside = (test: TestFile): boolean => {
    if (nodes.some(each => alike(each, test))) return false;
    if (node.kind === 'file' && folderOf(node.path) === folderOf(test.path)) return true;
    const holder = deepestHolding(test.path, nodes);
    return holder?.kind === 'package' && isAtOrUnder(node.path, holder);
  };
  return tests.filter(
    test =>
      isAtOrUnder(test.path, node) ||
      inside.some(each => alike(each, test)) ||
      testsWhatIsBeside(test),
  );
};

type NodeOfTestsOptions = {
  readonly nodes: ReadonlyArray<Placed>;
  readonly file: Pick<TestFile, 'path' | 'stack'>;
};

export const nodeOfTests = ({ nodes, file }: NodeOfTestsOptions): string | undefined => {
  const holder = deepestHolding(file.path, nodes);
  const alike = namedAlike(nodes);
  const named = nodes.find(
    each => alike(each, file) && (holder === undefined || isAtOrUnder(each.path, holder)),
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
  const alike = namedAlike(nodes);
  const nodeOf = new Map(nodes.map(node => [node.id, node]));
  return new Map(
    [...free].flatMap(part => {
      const path = nodeOf.get(part)?.path;
      const test = tests.find(file => file.path === path);
      if (test === undefined) return [];
      const subject = [...free].find(other => {
        const node = nodeOf.get(other);
        return other !== part && node?.kind === 'file' && alike(node, test);
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

type TestsWithoutNodesOptions = {
  readonly parts: ReadonlyArray<string>;
  readonly nodes: ReadonlyArray<GraphNode>;
  readonly tests: ReadonlyArray<TestFile>;
};

/**
 * Each changed test file the graph draws no node for, such as a Rust crate's `tests/` file, under
 * the last part in the reading order whose Tested by lists it, so the reading order shows it there.
 */
export const testsWithoutNodes = ({
  parts,
  nodes,
  tests,
}: TestsWithoutNodesOptions): ReadonlyMap<string, ReadonlyArray<TestFile>> => {
  const nodeOf = new Map(nodes.map(node => [node.id, node]));
  const drawn = new Set(nodes.map(({ path }) => path));
  const placed = tests
    .filter(test => !drawn.has(test.path) && ('unreadable' in test || anyChanged(test.statements)))
    .flatMap(test => {
      const part = parts.findLast(id => {
        const node = nodeOf.get(id);
        return node !== undefined && testsAlongside({ nodes, node, tests: [test] }).length > 0;
      });
      return part === undefined ? [] : [[part, test] as const];
    });
  return new Map(
    [...Map.groupBy(placed, ([part]) => part)].map(([part, pairs]) => [
      part,
      pairs.map(([, test]) => test),
    ]),
  );
};

/** A test file's path from the box holding it (`tests/index.rs`), else whole. */
export const testPathIn = (nodes: ReadonlyArray<GraphNode>, path: string): string => {
  const holder = deepestHolding(path, nodes);
  return holder === undefined || holder.path === '' ? path : path.slice(holder.path.length + 1);
};
